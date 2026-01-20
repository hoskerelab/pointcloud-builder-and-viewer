# backend/view_optimizer.py

import numpy as np
import os
from typing import List, Dict

def load_camera_data_from_npy(extrinsics_path: str):
    try:
        data = np.load(extrinsics_path)
        count = data.shape[0]
        if len(data.shape) == 1: 
            count = data.size // 12
            matrices = data.reshape((count, 3, 4))
        elif len(data.shape) == 3:
            matrices = data 
        else:
            matrices = data.reshape((-1, 3, 4))

        cameras = []
        for i in range(len(matrices)):
            w2c = matrices[i]
            R_w2c = w2c[:3, :3]
            t_w2c = w2c[:3, 3]
            
            # C2W for geometric distance check
            R_c2w = R_w2c.T
            center_world = -np.dot(R_c2w, t_w2c)
            
            cameras.append({
                'index': i,
                'w2c_R': R_w2c,
                'w2c_t': t_w2c,
                'center': center_world,
                'forward': R_c2w[:, 2] 
            })
        return cameras
    except Exception as e:
        print(f"Error loading Extrinsics: {e}")
        return []

def load_intrinsics_from_npy(intrinsics_path: str):
    try:
        data = np.load(intrinsics_path)
        if len(data.shape) == 1:
            count = data.size // 9
            return data.reshape((count, 3, 3))
        return data
    except Exception as e:
        print(f"Error loading Intrinsics: {e}")
        return None

def load_points3d(path):
    points = []
    if not os.path.exists(path): return None
    try:
        with open(path, 'r') as f:
            for line in f:
                if line.startswith("#"): continue
                parts = line.split()
                if len(parts) < 4: continue
                points.append([float(parts[1]), float(parts[2]), float(parts[3])])
        return np.array(points)
    except Exception: return None

def calculate_view_redundancy(cameras: List[Dict], dist_threshold: float = 1.5, angle_threshold_deg: float = 15.0) -> List[int]:
    if not cameras: return []
    kept_indices = []
    
    camera_data = []
    for i, cam in enumerate(cameras):
        camera_data.append({'pos': cam['center'], 'fwd': cam['forward'], 'idx': i})

    angle_threshold_rad = np.radians(angle_threshold_deg)

    for i, current in enumerate(camera_data):
        is_redundant = False
        for kept_idx in kept_indices:
            kept = camera_data[kept_idx]
            dist = np.linalg.norm(current['pos'] - kept['pos'])
            dot = np.dot(current['fwd'], kept['fwd'])
            angle = np.arccos(np.clip(dot, -1.0, 1.0))
            
            if dist < dist_threshold and angle < angle_threshold_rad:
                is_redundant = True
                break
        if not is_redundant:
            kept_indices.append(i)

    print(f"[Geometric] Input: {len(cameras)} -> Output: {len(kept_indices)}")
    return kept_indices


def calculate_coverage_redundancy(cameras, points_path, intrinsics_path, max_cameras=None, img_size=(4032, 3024)):
    """
    Selects cameras using Frustum Checking + Z-Grid Occlusion.
    If max_cameras is None, it runs until 99% coverage.
    """
    points = load_points3d(points_path)
    if points is None: return []
    
    intrinsics = load_intrinsics_from_npy(intrinsics_path)
    if intrinsics is None: return calculate_view_redundancy(cameras)

    print(f"Optimizing coverage for {len(points)} points (Simulated Occlusion enabled)...")

    # 1. Subsample? Maybe not if we want accuracy. 
    # Let's keep 20k points for robustness.
    if len(points) > 20000:
        indices = np.random.choice(len(points), 20000, replace=False)
        points = points[indices]

    num_cams = len(cameras)
    num_points = len(points)
    coverage = np.zeros((num_cams, num_points), dtype=bool)
    
    width, height = img_size
    
    # Occlusion Grid Resolution (Lower = More Aggressive Occlusion Culling)
    # 64x64 grid roughly means we check visibility in blocks of ~60 pixels.
    # Only the closest point in that block is visible.
    GRID_RES = 64 

    for i in range(num_cams):
        cam = cameras[i]
        K = intrinsics[i] 
        
        # A. Transform to Camera Frame
        # (N, 3)
        P_cam = np.dot(points, cam['w2c_R'].T) + cam['w2c_t'] 
        
        # B. Depth Check
        valid_depth = P_cam[:, 2] > 0.1 
        indices_valid = np.where(valid_depth)[0]
        
        if len(indices_valid) == 0: continue
            
        P_valid = P_cam[indices_valid]
        z = P_valid[:, 2]
        u = (K[0,0] * P_valid[:, 0] / z) + K[0,2]
        v = (K[1,1] * P_valid[:, 1] / z) + K[1,2]
        
        # C. Image Bounds Check
        in_view = (u >= 0) & (u < width) & (v >= 0) & (v < height)
        
        # --- D. OCCLUSION CHECK (The "Z-Grid") ---
        
        # Filter to only points actually on screen
        screen_indices = indices_valid[in_view] # Original Indices
        screen_z = z[in_view]
        screen_u = u[in_view]
        screen_v = v[in_view]

        if len(screen_indices) == 0: continue

        # Quantize pixels to grid coordinates
        grid_x = (screen_u / width * GRID_RES).astype(int)
        grid_y = (screen_v / height * GRID_RES).astype(int)
        
        # We want to find the point with MIN Z for every (grid_x, grid_y)
        # 1. Pack keys: (y * RES + x)
        keys = grid_y * GRID_RES + grid_x
        
        # 2. Sort by Key, then by Z (Depth)
        sort_order = np.lexsort((screen_z, keys))
        
        sorted_keys = keys[sort_order]
        sorted_indices = screen_indices[sort_order]
        
        # 3. Unique keys (np.unique returns first occurrence, which is min Z because we sorted)
        _, unique_positions = np.unique(sorted_keys, return_index=True)
        
        # These are the indices of the "Front-most" points in each grid cell
        visible_closest_indices = sorted_indices[unique_positions]
        
        # Mark coverage
        coverage[i, visible_closest_indices] = True

    # 3. Greedy Set Cover
    kept_indices = []
    covered_mask = np.zeros(num_points, dtype=bool)
    
    target_cams = max_cameras if max_cameras is not None else num_cams
    
    print("Running Set Cover...")

    while len(kept_indices) < target_cams:
        best_idx = -1
        best_gain = -1
        
        for i in range(num_cams):
            if i in kept_indices: continue
            
            new_points = coverage[i] & (~covered_mask)
            gain = np.sum(new_points)
            
            if gain > best_gain:
                best_gain = gain
                best_idx = i
        
        # Stop if diminishing returns
        if best_idx == -1 or best_gain < 5: # If a camera adds < 5 new points, stop
            break
            
        kept_indices.append(best_idx)
        covered_mask |= coverage[best_idx]
        
        coverage_pct = (np.sum(covered_mask) / num_points) * 100
        # print(f"  + Cam {best_idx}: {coverage_pct:.1f}% covered (+{best_gain} pts)")
        
        if coverage_pct > 99.0:
            print("  > 99% Coverage achieved.")
            break

    print(f"[Coverage] Selected {len(kept_indices)} cameras. Final Coverage: {np.sum(covered_mask)/num_points*100:.1f}%")
    return sorted(kept_indices)