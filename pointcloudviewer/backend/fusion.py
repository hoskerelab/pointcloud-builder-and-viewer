# backend/fusion.py

import os
import numpy as np
import cv2
import json
import torch
from tqdm import tqdm 
from PIL import Image 
from view_optimizer import load_camera_data_from_npy, load_intrinsics_from_npy, load_points3d
from segmentation import run_segmentation

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

def project_points_to_camera(points_3d, camera, K, img_w, img_h):
    """Standard 3D -> 2D projection with depth check."""
    P_cam = np.dot(points_3d, camera['w2c_R'].T) + camera['w2c_t']
    valid_z = P_cam[:, 2] > 0.1
    
    if not np.any(valid_z): return None, None
        
    P_valid = P_cam[valid_z]
    indices_valid = np.where(valid_z)[0]
    
    z = P_valid[:, 2]
    u = (K[0,0] * P_valid[:, 0] / z) + K[0,2]
    v = (K[1,1] * P_valid[:, 1] / z) + K[1,2]
    
    in_view = (u >= 0) & (u < img_w) & (v >= 0) & (v < img_h)
    
    if not np.any(in_view): return None, None
        
    return np.stack([u[in_view], v[in_view]], axis=1), indices_valid[in_view]

def save_debug_image(image_path, output_path, polygons, prompt):
    """Generates a visual debug image with transparent masks and bounding boxes."""
    img = cv2.imread(image_path)
    if img is None: return
    
    overlay = img.copy()
    h, w = img.shape[:2]
    
    # Draw Polygons (Red)
    for poly in polygons:
        pts = np.array([[int(p['x'] * w), int(p['y'] * h)] for p in poly['points']], dtype=np.int32)
        pts = pts.reshape((-1, 1, 2))
        cv2.fillPoly(overlay, [pts], (0, 0, 255)) # BGR Red
        cv2.polylines(img, [pts], True, (0, 0, 255), 2)
        
        # Draw Debug Box if available (Cyan)
        if 'debug_box' in poly and poly['debug_box']:
            box = poly['debug_box']['box_2d'] # [x1, y1, x2, y2] normalized
            bx1, by1, bx2, by2 = int(box[0]*w), int(box[1]*h), int(box[2]*w), int(box[3]*h)
            cv2.rectangle(img, (bx1, by1), (bx2, by2), (255, 255, 0), 2)
            cv2.putText(img, f"{poly['label']}", (bx1, by1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

    cv2.addWeighted(overlay, 0.4, img, 0.6, 0, img)
    cv2.imwrite(output_path, img)

def run_3d_fusion(scene_path, prompt, confidence_threshold=0.5, force_recompute=False):
    print(f"--- 3D Semantic Fusion: '{prompt}' ---")
    
    # 1. Setup Output Directories
    # Sanitize prompt
    safe_prompt = "".join(c if c.isalnum() else "_" for c in prompt)
    OUTPUT_ROOT = os.path.join(scene_path, "segmentation_cache", safe_prompt)
    VIEWS_DIR = os.path.join(OUTPUT_ROOT, "views")
    FUSED_FILE = os.path.join(OUTPUT_ROOT, "fused_result.json")
    
    # CHECK: If result exists and we aren't forcing recompute, load it!
    if os.path.exists(FUSED_FILE) and not force_recompute:
        print(f"✅ Found cached fusion result at {FUSED_FILE}")
        with open(FUSED_FILE, 'r') as f:
            return json.load(f)

    ensure_dir(VIEWS_DIR)

    # 2. Load Geometry
    extrinsics_path = os.path.join(scene_path, "camera_extrinsics.npy")
    intrinsics_path = os.path.join(scene_path, "camera_intrinsics.npy")
    points_path = os.path.join(scene_path, "sparse", "points3D.txt")
    images_dir = os.path.join(scene_path, "images")
    
    cameras = load_camera_data_from_npy(extrinsics_path)
    intrinsics = load_intrinsics_from_npy(intrinsics_path)
    points_3d = load_points3d(points_path)
    
    if points_3d is None: return {"error": "Could not load 3D points"}

    point_votes = np.zeros(len(points_3d), dtype=np.float32)
    point_observations = np.zeros(len(points_3d), dtype=np.float32)
    
    # Get image size from first image
    valid_images = sorted([f for f in os.listdir(images_dir) if f.lower().endswith(('.jpg', '.png'))])
    img0_path = os.path.join(images_dir, valid_images[0])
    with Image.open(img0_path) as img:
        img_w, img_h = img.size

    print(f"Processing {len(cameras)} views...")

    # 3. Iterate Views
    for i, cam in enumerate(tqdm(cameras)):
        if i >= len(valid_images): break
        image_name = valid_images[i]
        image_path = os.path.join(images_dir, image_name)
        
        # Define Cache Files for this specific view
        base_name = os.path.splitext(image_name)[0]
        mask_npy_path = os.path.join(VIEWS_DIR, f"{base_name}_mask.npy")
        meta_json_path = os.path.join(VIEWS_DIR, f"{base_name}_data.json")
        debug_img_path = os.path.join(VIEWS_DIR, f"{base_name}_debug.png")
        
        mask = None
        
        # A. Check if this specific image is already processed
        if os.path.exists(mask_npy_path) and not force_recompute:
            mask = np.load(mask_npy_path)
        else:
            # Run AI (Florence-2 + SAM 2) with Debug Mode enabled
            results = run_segmentation(image_path, prompt, debug=True)
            
            # Create Binary Mask for Voting
            mask = np.zeros((img_h, img_w), dtype=np.uint8)
            for poly in results:
                pts = np.array([[p['x']*img_w, p['y']*img_h] for p in poly['points']], dtype=np.int32)
                cv2.fillPoly(mask, [pts], 1)
            
            # Save Artifacts
            # 1. Fast loading binary mask
            np.save(mask_npy_path, mask)
            
            # 2. Rich Metadata (Polygons + BBoxes)
            with open(meta_json_path, 'w') as f:
                json.dump(results, f, indent=2)
                
            # 3. Visual Debug Image (Optional, slows down slightly but worth it)
            save_debug_image(image_path, debug_img_path, results, prompt)

        # B. 3D Voting (Projection)
        uvs, indices = project_points_to_camera(points_3d, cam, intrinsics[i], img_w, img_h)
        if uvs is None: continue
        
        uvs_int = np.round(uvs).astype(int)
        uvs_int[:, 0] = np.clip(uvs_int[:, 0], 0, img_w - 1)
        uvs_int[:, 1] = np.clip(uvs_int[:, 1], 0, img_h - 1)
        
        hits = mask[uvs_int[:, 1], uvs_int[:, 0]]
        point_votes[indices] += hits
        point_observations[indices] += 1

    # 4. Final Consensus
    valid_obs = point_observations > 0
    final_scores = np.zeros(len(points_3d))
    final_scores[valid_obs] = point_votes[valid_obs] / point_observations[valid_obs]
    
    confirmed_indices = np.where(final_scores > confidence_threshold)[0]
    
    result_payload = {
        "point_indices": confirmed_indices.tolist(),
        "point_scores": final_scores.tolist(),
        "total_points": len(points_3d),
        "prompt": prompt
    }
    
    # 5. Save Final Fused Result
    with open(FUSED_FILE, 'w') as f:
        json.dump(result_payload, f)
        
    print(f"✅ Fusion Saved to: {FUSED_FILE}")
    print(f"   Matches: {len(confirmed_indices)} / {len(points_3d)}")
    
    return result_payload