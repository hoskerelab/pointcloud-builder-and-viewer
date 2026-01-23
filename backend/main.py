import os
import glob
import argparse
import uuid
import traceback
import time
import asyncio

import numpy as np
import torch
from tqdm.auto import tqdm
import cv2
import matplotlib.pyplot as plt
import open3d as o3d

import vggt_slam.slam_utils as utils
from vggt_slam.solver import Solver

from vggt.models.vggt import VGGT

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, WebSocket
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import tempfile
import os

solver = None  
model = None 
accumulated_images = {}  
accepted_sequences = set()
SUBMAP_SIZE = 16
temp_dir = "/tmp/vggt_images"
os.makedirs(temp_dir, exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global solver, model
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    solver = Solver(
        init_conf_threshold=25.0,
        use_point_map=False,
        use_sim3=True,
        gradio_mode=False,
        vis_stride = 1,
        vis_point_size = 0.003,
        vis_mode=False
    )

   

    model = VGGT()
    model.load_state_dict(torch.load("/home/sailuh/Desktop/Electron Visualizer/backend/VGGT-SLAM/checkpoints/model.pt"))

    model.eval()
    model = model.to(device)
    yield

app = FastAPI(lifespan=lifespan)


async def send_keepalive(websocket: WebSocket):
    """Send periodic ping messages to keep WebSocket connection alive during processing"""
    try:
        while True:
            await asyncio.sleep(10)  
            await websocket.send_text("ping")
    except Exception:
        pass


@app.post("/process_image")
async def process_image(file: UploadFile = File(...), sequence: int = Form(0)):
    os.makedirs(temp_dir, exist_ok=True)
    # Save uploaded image with consistent naming
    image_path = os.path.join(temp_dir, f"frame_{sequence:06d}.png")
    with open(image_path, 'wb') as f:
        f.write(await file.read())
    
    accumulated_images[sequence] = image_path 
    # Check if we have at least SUBMAP_SIZE images
    if len(accumulated_images) >= SUBMAP_SIZE:
        # Sort by sequence
        sorted_sequences = sorted(accumulated_images.keys())
        batch = []
        for seq in sorted_sequences:
            img_path = accumulated_images[seq]
            img = cv2.imread(img_path)
            enough_disparity = solver.flow_tracker.compute_disparity(img, 50, False)
            if enough_disparity:
                print(f"{image_path} {sequence} Added to batch")
                batch.append(img_path)
                if len(batch) == SUBMAP_SIZE + 1:
                    break
    
    return {"message": f"Image {sequence} received. Waiting for more."}

@app.websocket("/ws/upload")
async def websocket_upload(websocket: WebSocket):
    await websocket.accept()
    sequence_counter = 0
    last_receive_time = time.time()
    processing_task = None
    pending_batch = None 
    keepalive_task = None  

    try:
        while True:
            # Check if there's an ongoing processing task
            if processing_task and processing_task.done():
                # Processing is complete, send results
                try:
                    ply_file, unique_id = processing_task.result()

                    # Cancel keepalive task if it exists
                    if 'keepalive_task' in locals() and keepalive_task and not keepalive_task.done():
                        keepalive_task.cancel()
                        try:
                            await keepalive_task
                        except asyncio.CancelledError:
                            pass

                    # Read the PLY file and send it back over WebSocket
                    with open(ply_file, 'rb') as f:
                        ply_data = f.read()

                    # Send filename first, then the binary data
                    await websocket.send_text(f"filename:{unique_id}")
                    await websocket.send_bytes(ply_data)

                    print(f"Sent PLY file: submap_{unique_id}.ply")

                    # Remove temporary PLY file after sending
                    try:
                        os.remove(ply_file)
                        print(f"Deleted temporary PLY file: {ply_file}")
                    except OSError as e:
                        print(f"Failed to delete temporary PLY file {ply_file}: {e}")

                    processing_task = None

                    # Check if there's a pending batch to process now
                    if pending_batch is not None:
                        processing_task = asyncio.create_task(process_batch_async(pending_batch, solver, model, accumulated_images))
                        pending_batch = None
                        print("Started processing pending batch")
                        keepalive_task = asyncio.create_task(send_keepalive(websocket))

                except Exception as e:
                    print("Error sending processed results:")
                    print(traceback.format_exc())
                    await websocket.send_text(f"error:{str(e)}")
                    processing_task = None

            try:
                if processing_task is None:
                    data = await asyncio.wait_for(websocket.receive_bytes(), timeout=5.0)
                    last_receive_time = time.time()
                else:
                    data = await websocket.receive_bytes()
            except asyncio.TimeoutError:
                if time.time() - last_receive_time > 30.0:
                    print("WebSocket timeout - closing connection")
                    break
                continue
            except Exception:
                print("WebSocket connection closed by client or no more data")
                break

            image_path = os.path.join(temp_dir, f"frame_{sequence_counter:06d}.png") 
            with open(image_path, 'wb') as f:
                f.write(data)
                f.flush() 
                os.fsync(f.fileno()) 

            # Verify the image can be read and check its properties
            if os.path.exists(image_path) and os.path.getsize(image_path) > 0:
                test_img = cv2.imread(image_path)
                if test_img is not None:
                    print(f"Saved image {sequence_counter}: {image_path}, shape={test_img.shape}")
                    # Run disparity check ONCE when the frame arrives
                    enough_disparity = solver.flow_tracker.compute_disparity(test_img, 25, False)
                    print(f"Image {sequence_counter}: initial disparity check = {enough_disparity}")
                    if enough_disparity:
                        accumulated_images[sequence_counter] = image_path
                        accepted_sequences.add(sequence_counter)
                        print(f"Added image {sequence_counter} to accumulated_images and accepted_sequences")
                    else:
                        print(f"Image {sequence_counter} rejected due to low disparity")
                else:
                    print(f"Warning: Could not read saved image {sequence_counter}")
                    continue

            # Build batches only from frames that have already passed disparity once
            if len(accepted_sequences) >= SUBMAP_SIZE + 1:
                print(f"Have {len(accepted_sequences)} accepted images, attempting to build batch...")
                sorted_accepted = sorted(accepted_sequences)
                batch = []
                used_seqs = []

                for seq in sorted_accepted:
                    img_path = accumulated_images.get(seq)
                    if img_path is None:
                        continue

                    # Verify file exists and is readable before including in batch
                    if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
                        img = cv2.imread(img_path)
                        if img is not None and img.size > 0:
                            batch.append(img_path)
                            used_seqs.append(seq)
                            print(f"Added to batch {seq}: {img_path} (batch size: {len(batch)})")
                            if len(batch) == SUBMAP_SIZE + 1:
                                print(f"Batch complete with {len(batch)} images!")
                                break
                        else:
                            print(f"Warning: Could not read image {img_path}, removing from accumulated and accepted_sequences")
                            accumulated_images.pop(seq, None)
                            accepted_sequences.discard(seq)
                    else:
                        print(f"Warning: Image file {img_path} not found or empty, removing from accumulated and accepted_sequences")
                        accumulated_images.pop(seq, None)
                        accepted_sequences.discard(seq)

                # Only remove images from state if we successfully created a batch
                if len(batch) == SUBMAP_SIZE + 1:
                    # Remove all images that were used in this batch EXCEPT the last one (overlap)
                    overlap_seq = used_seqs[-1]
                    for seq in used_seqs[:-1]:
                        accumulated_images.pop(seq, None)
                        accepted_sequences.discard(seq)
                        print(f"Removed processed image {seq} from accumulated and accepted_sequences")

                    print(f"Kept overlap image {overlap_seq}: {accumulated_images.get(overlap_seq)}")

                    if processing_task is None:
                        processing_task = asyncio.create_task(process_batch_async(batch, solver, model, accumulated_images))
                        print("Started processing batch")
                        # Start a keepalive task to prevent WebSocket timeout during long processing
                        keepalive_task = asyncio.create_task(send_keepalive(websocket))
                    else:
                        # Processing ongoing, queue this batch
                        if pending_batch is None:
                            pending_batch = batch
                            print("Queued batch for processing")
                        else:
                            print("Already have a pending batch, skipping this one")
                else:
                    print(f"Could not build complete batch from accepted images. Got {len(batch)}, need {SUBMAP_SIZE + 1}")

            sequence_counter += 1

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if processing_task and not processing_task.done():
            processing_task.cancel()
            try:
                await processing_task
            except asyncio.CancelledError:
                pass
        
        if 'keepalive_task' in locals() and keepalive_task and not keepalive_task.done():
            keepalive_task.cancel()
            try:
                await keepalive_task
            except asyncio.CancelledError:
                pass

        # Process any remaining accepted images as a final partial batch
        try:
            if accepted_sequences:
                remaining_seqs = sorted(accepted_sequences)
                final_batch = []
                for seq in remaining_seqs:
                    img_path = accumulated_images.get(seq)
                    if not img_path:
                        continue
                    if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
                        img = cv2.imread(img_path)
                        if img is not None and img.size > 0:
                            final_batch.append(img_path)

                if len(final_batch) > 0:
                    print(f"Processing final partial batch with {len(final_batch)} images")
                    try:
                        ply_file, unique_id = await process_batch_async(final_batch, solver, model, accumulated_images)
                        # Attempt to send the final result if the WebSocket is still open
                        try:
                            with open(ply_file, 'rb') as f:
                                ply_data = f.read()
                            await websocket.send_text(f"filename:{unique_id}")
                            await websocket.send_bytes(ply_data)
                            print(f"Sent final partial PLY file: submap_{unique_id}.ply")
                            # Remove temporary PLY file after sending
                            try:
                                os.remove(ply_file)
                                print(f"Deleted temporary final PLY file: {ply_file}")
                            except OSError as e:
                                print(f"Failed to delete temporary final PLY file {ply_file}: {e}")
                        except Exception as send_err:
                            print(f"Could not send final partial batch result: {send_err}")
                    except Exception as final_err:
                        print(f"Error while processing final partial batch: {final_err}")
        except Exception as e:
            print(f"Error during final batch handling: {e}")

        # TO-DO: Have camera poses save to a tmp txt file and sent to the front end for display
        # solver.map.write_poses_to_file("/home/sailuh/Desktop/Electron Visualizer/RealtimePointCloudBuilderAndViewer/conf_values_test/posestest.txt")

        try:
            # Remove all temp images since the session is ending
            for filename in os.listdir(temp_dir):
                if filename.startswith("frame_") and filename.endswith(".png"):
                    filepath = os.path.join(temp_dir, filename)
                    try:
                        os.remove(filepath)
                        print(f"Cleaned up temp image: {filename}")
                    except OSError:
                        pass 
        except Exception as e:
            print(f"Error during temp file cleanup: {e}")

        # Clear in-memory tracking structures for this session
        accumulated_images.clear()
        accepted_sequences.clear()

        try:
            await websocket.close()
        except RuntimeError as e:
            if "websocket.close" in str(e):
                pass  
            else:
                raise


async def process_batch_async(batch, solver, model, accumulated_images):
    """Process a batch of images asynchronously
    
    Each batch contains SUBMAP_SIZE + 1 images:
    - The first image overlaps with the previous batch (except for the very first batch)
    - SUBMAP_SIZE new images
    - The last image will be kept for overlap with the next batch
    """
    try:
        ply_file, unique_id = new_process_submap(batch, solver, model)
        return ply_file, unique_id
    except Exception as e:
        print("Error in background processing:")
        print(traceback.format_exc())
        raise


def new_process_submap(images, solver, model):
    def get_seq(path):
        basename = os.path.basename(path)
        seq_str = basename.split('_')[1].split('.')[0]
        return int(seq_str)
    
    seqs = [get_seq(p) for p in images]
    print("Batch seqs:", seqs)
    
    images = sorted(images, key=get_seq)
    print(images)
    predictions = solver.run_predictions(images, model, 1)

    solver.add_points(predictions)
    solver.graph.optimize()
    solver.map.update_submap_homographies(solver.graph)


    all_submaps = list(solver.map.ordered_submaps_by_key()) 
    submap = all_submaps[-1] 
    pcd = submap.get_points_in_world_frame()
    pcd = pcd.reshape(-1, 3)
    colors = submap.get_points_colors()
    if colors.max() > 1.0:
        colors = colors / 255.0

    pcd_cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(pcd))
    pcd_cloud.colors = o3d.utility.Vector3dVector(colors)
    voxel_size = 0.005
    pcd_cloud = pcd_cloud.voxel_down_sample(voxel_size=voxel_size)

    unique_id = str(uuid.uuid4())[:8]  # Short UUID for filename (e.g., 'a1b2c3d4')

    # Create PLY in a temporary file
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".ply")
    ply_file = tmp_file.name
    tmp_file.close()
    success = o3d.io.write_point_cloud(ply_file, pcd_cloud)
    if not success:
        raise Exception("Failed to create PLY")
    return ply_file, unique_id

def process_submap(images, solver, model):
    image_names_subset = []
    for image_name in tqdm(images):
        img = cv2.imread(image_name)
        enough_disparity = solver.flow_tracker.compute_disparity(img, 50, False)
        if enough_disparity:
            image_names_subset.append(image_name)

        # Run submap processing if enough images are collected or if it's the last group of images.
        if len(image_names_subset) == SUBMAP_SIZE + 1 or image_name == images[-1]:
            print(image_names_subset)
            predictions = solver.run_predictions(image_names_subset, model, 1)

            solver.add_points(predictions)

            solver.graph.optimize()
            solver.map.update_submap_homographies(solver.graph)
        
            all_submaps = list(solver.map.ordered_submaps_by_key()) 
            submap_id = len(all_submaps)
            submap = all_submaps[-1] 

            pcd = submap.get_points_in_world_frame()
            pcd = pcd.reshape(-1, 3)
            colors = submap.get_points_colors()

            if colors.max() > 1.0:
                colors = colors / 255.0

            pcd_cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(pcd))
            pcd_cloud.colors = o3d.utility.Vector3dVector(colors)

            voxel_size = 0.005
            pcd_cloud = pcd_cloud.voxel_down_sample(voxel_size=voxel_size)

            unique_id = str(uuid.uuid4())[:8]  # Short UUID for filename (e.g., 'a1b2c3d4')
    
            # Create GLB directly from pcd_cloud
            glb_file = tempfile.NamedTemporaryFile(delete=False, suffix=".glb").name
            mesh = o3d.geometry.TriangleMesh(vertices=pcd_cloud.points, vertex_colors=pcd_cloud.colors)
            success = o3d.io.write_triangle_mesh(glb_file, mesh, write_ascii=False)
            if not success:
                raise Exception("Failed to create GLB")

            # Return the GLB file path and unique ID (for frontend tracking if needed)
            return glb_file, unique_id