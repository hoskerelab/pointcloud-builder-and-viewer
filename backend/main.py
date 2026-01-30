import os
import glob
import argparse
import uuid
import traceback
import time
import asyncio
import sys
import io

import numpy as np
import torch
from tqdm.auto import tqdm
import cv2
import matplotlib.pyplot as plt
import open3d as o3d

import vggt_slam.slam_utils as utils
from vggt_slam.solver import Solver

from vggt.models.vggt import VGGT

from depth_projection import load_calibration, project_depth_onto_rgb, CALIBRATION_FILE

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

# WebSocket clients receiving completed submap PLYs
viewer_sockets: set[WebSocket] = set()

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
    model.load_state_dict(torch.load("checkpoints/model.pt"))

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


async def broadcast_ply_to_viewers(ply_data: bytes, unique_id: str) -> None:
    """Send a completed submap PLY to all connected viewer WebSockets.

    Uses the same filename + binary protocol as the uploader connection.
    """
    if not viewer_sockets:
        return

    dead: list[WebSocket] = []
    for ws in list(viewer_sockets):
        try:
            await ws.send_text(f"filename:{unique_id}")
            await ws.send_bytes(ply_data)
        except Exception:
            dead.append(ws)

    for ws in dead:
        try:
            viewer_sockets.discard(ws)
        except Exception:
            pass


@app.websocket("/ws/submaps")
async def websocket_submaps(websocket: WebSocket):
    """Viewer WebSocket for receiving completed submap PLYs.
    """
    await websocket.accept()
    viewer_sockets.add(websocket)
    try:
        # Keep the connection open
        while True:
            await asyncio.sleep(3600)
    except Exception:
        pass
    finally:
        try:
            viewer_sockets.discard(websocket)
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
    use_captured_depth_session = False
    depth_is_raw = False
    return_ply = True
    expecting_depth = False
    last_image_seq = None
    calib = None

    try:
        while True:
            # Check if there's an ongoing processing task
            if processing_task and processing_task.done():
                # Processing is complete, optionally send results
                try:
                    ply_file, unique_id = processing_task.result()

                    # Cancel keepalive task if it exists
                    if 'keepalive_task' in locals() and keepalive_task and not keepalive_task.done():
                        keepalive_task.cancel()
                        try:
                            await keepalive_task
                        except asyncio.CancelledError:
                            pass


                    with open(ply_file, 'rb') as f:
                        ply_data = f.read()

                    # Broadcast to any connected viewers 
                    await broadcast_ply_to_viewers(ply_data, unique_id)

                    if return_ply:
                        # Send filename first, then the binary data back
                        # to the uploader connection.
                        await websocket.send_text(f"filename:{unique_id}")
                        await websocket.send_bytes(ply_data)
                        print(f"Sent PLY file to uploader: submap_{unique_id}.ply")
                    else:
                        print(f"Processed batch {unique_id}, PLY returned only to viewers (live stream mode)")

                    # Remove temporary PLY file after use
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
                    if return_ply:
                        await websocket.send_text(f"error:{str(e)}")
                    processing_task = None

            try:
                if processing_task is None:
                    message = await asyncio.wait_for(websocket.receive(), timeout=5.0)
                    last_receive_time = time.time()
                else:
                    message = await websocket.receive()
            except asyncio.TimeoutError:
                if time.time() - last_receive_time > 30.0:
                    print("WebSocket timeout - closing connection")
                    break
                continue
            except Exception:
                print("WebSocket connection closed by client or no more data")
                break

            # Handle text vs binary messages
            data_text = message.get("text") if isinstance(message, dict) else None
            data_bytes = message.get("bytes") if isinstance(message, dict) else None

            if data_text is not None:
                # Control / status messages
                if data_text == "done":
                    print("Received done signal from client")
                    break
                if data_text == "pong":
                    continue
                if data_text.startswith("config:use_depth_maps:"):
                    flag = data_text.split(":")[-1]
                    use_captured_depth_session = flag.strip() in ("1", "true", "True")
                    depth_is_raw = False
                    print(f"Use captured depth for this session (projected): {use_captured_depth_session}")
                    continue
                if data_text.startswith("config:use_raw_depth:"):
                    flag = data_text.split(":" )[-1]
                    use_captured_depth_session = flag.strip() in ("1", "true", "True")
                    depth_is_raw = True
                    print(f"Use raw depth for this session: {use_captured_depth_session}")
                    continue
                if data_text.startswith("config:live_stream:"):
                    flag = data_text.split(":")[-1]
                    # live_stream=1 means this connection is only for
                    # feeding frames; point clouds will be fetched via
                    # a separate HTTP endpoint instead of this WebSocket.
                    return_ply = not (flag.strip() in ("1", "true", "True"))
                    print(f"Return PLY over WebSocket: {return_ply}")
                    continue
                # Unknown text message; ignore but keep connection alive
                print(f"Ignoring text message on WebSocket: {data_text}")
                continue

            if data_bytes is None:
                # Nothing useful received
                continue

            if use_captured_depth_session and expecting_depth and last_image_seq is not None:
                depth_path = os.path.join(temp_dir, f"frame_{last_image_seq:06d}_depth_proj_mm.npy")
                try:
                    if depth_is_raw:
                        # Load raw depth from NPY bytes
                        depth_raw = np.load(io.BytesIO(data_bytes))

                        # Load corresponding RGB frame to get target shape
                        rgb_path = os.path.join(temp_dir, f"frame_{last_image_seq:06d}.png")
                        rgb_img = cv2.imread(rgb_path)
                        if rgb_img is None:
                            raise RuntimeError(f"Could not read RGB image for projection: {rgb_path}")

                        # Load calibration once
                        if calib is None:
                            calib = load_calibration(CALIBRATION_FILE)

                        depth_proj_mm = project_depth_onto_rgb(
                            depth_raw,
                            calib["K_iToF"],
                            calib["dist_iToF"],
                            calib["K_RGB"],
                            calib["dist_RGB"],
                            calib["R"],
                            calib["T"],
                            rgb_img.shape,
                        )

                        np.save(depth_path, depth_proj_mm.astype(np.float32))
                        print(f"Projected and saved depth map for frame {last_image_seq}: {depth_path}")
                    else:
                        # Already projected depth; save bytes directly
                        with open(depth_path, 'wb') as f:
                            f.write(data_bytes)
                            f.flush()
                            os.fsync(f.fileno())
                        print(f"Saved depth map for frame {last_image_seq}: {depth_path}")
                except Exception as e:
                    print(f"Failed to handle depth map for frame {last_image_seq}: {e}")
                expecting_depth = False
                continue

            # Otherwise, treat this binary payload as an RGB image frame.
            image_path = os.path.join(temp_dir, f"frame_{sequence_counter:06d}.png") 
            with open(image_path, 'wb') as f:
                f.write(data_bytes)
                f.flush() 
                os.fsync(f.fileno()) 

            # Verify the image can be read and check its properties
            if os.path.exists(image_path) and os.path.getsize(image_path) > 0:
                test_img = cv2.imread(image_path)
                if test_img is not None:
                    print(f"Saved image {sequence_counter}: {image_path}, shape={test_img.shape}")
                    # Run disparity check ONCE when the frame arrives
                    enough_disparity = solver.flow_tracker.compute_disparity(test_img, 97, False)
                    print(f"Image {sequence_counter}: initial disparity check = {enough_disparity}")
                    if enough_disparity:
                        accumulated_images[sequence_counter] = image_path
                        accepted_sequences.add(sequence_counter)
                        print(f"Added image {sequence_counter} to accumulated_images and accepted_sequences")
                        if use_captured_depth_session:
                            last_image_seq = sequence_counter
                            expecting_depth = True
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

                            # Always broadcast final submap to any connected viewers
                            await broadcast_ply_to_viewers(ply_data, unique_id)

                            if return_ply:
                                await websocket.send_text(f"filename:{unique_id}")
                                await websocket.send_bytes(ply_data)
                                print(f"Sent final partial PLY file to uploader: submap_{unique_id}.ply")
                            else:
                                print(f"Final partial batch {unique_id} processed; PLY returned only to viewers (live stream mode)")

                            # Remove temporary PLY file after sending or discarding
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
            # Remove all temp images
            for filename in os.listdir(temp_dir):
                # Remove RGB images
                if filename.startswith("frame_") and filename.endswith(".png"):
                    filepath = os.path.join(temp_dir, filename)
                    try:
                        os.remove(filepath)
                        print(f"Cleaned up temp image: {filename}")
                    except OSError:
                        pass 
                # Remove depth maps
                if filename.startswith("frame_") and filename.endswith("_depth_proj_mm.npy"):
                    filepath = os.path.join(temp_dir, filename)
                    try:
                        os.remove(filepath)
                        print(f"Cleaned up temp depth map: {filename}")
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
        # Determine depth map paths for this batch (if they exist on disk).
        depth_paths = []
        for img_path in batch:
            basename = os.path.basename(img_path)
            try:
                seq_str = basename.split('_')[1].split('.')[0]
                seq = int(seq_str)
                depth_path = os.path.join(temp_dir, f"frame_{seq:06d}_depth_proj_mm.npy")
                depth_paths.append(depth_path if os.path.exists(depth_path) else None)
            except Exception:
                depth_paths.append(None)

        ply_file, unique_id = new_process_submap(batch, solver, model, depth_paths)
        return ply_file, unique_id
    except Exception as e:
        print("Error in background processing:")
        print(traceback.format_exc())
        raise


def new_process_submap(images, solver, model, depth_paths=None):
    def get_seq(path):
        basename = os.path.basename(path)
        seq_str = basename.split('_')[1].split('.')[0]
        return int(seq_str)
    
    seqs = [get_seq(p) for p in images]
    print("Batch seqs:", seqs)
    
    images = sorted(images, key=get_seq)
    print(images)

    # Align depth paths order with sorted images, if provided
    ordered_depth_paths = None
    if depth_paths is not None:
        depth_by_seq = {}
        for img_path, d_path in zip(images, depth_paths):
            try:
                seq = get_seq(img_path)
                depth_by_seq[seq] = d_path
            except Exception:
                continue
        ordered_depth_paths = []
        for img_path in images:
            try:
                seq = get_seq(img_path)
                ordered_depth_paths.append(depth_by_seq.get(seq))
            except Exception:
                ordered_depth_paths.append(None)

    predictions = solver.run_predictions(images, model, 1)

    if ordered_depth_paths is not None:
        solver.add_points(predictions, ordered_depth_paths)
    else:
        solver.add_points(predictions)

    solver.graph.optimize()
    solver.map.update_submap_homographies(solver.graph)

    global_scale = None
    if hasattr(solver, "get_global_depth_scale"):
        global_scale = solver.get_global_depth_scale()

    if global_scale is not None and hasattr(solver.map, "set_global_scale"):
        try:
            solver.map.set_global_scale(global_scale * 1e-3)
        except Exception:
            pass

    # Refinement will apply across all submaps that have
    # depth_paths stored.
    if depth_paths is not None and any(p is not None for p in depth_paths):
        if hasattr(solver.map, "refine_points_with_depth"):
            try:
                solver.map.refine_points_with_depth()
            except Exception as e:
                print("Warning: refine_points_with_depth failed:", e)

    all_submaps = list(solver.map.ordered_submaps_by_key()) 
    submap = all_submaps[-1] 
    pcd = submap.get_points_in_world_frame()
    pcd = pcd.reshape(-1, 3)
    # Apply global scale on export
    scale = getattr(solver.map, "global_scale", 1.0)
    pcd = pcd * scale

    colors = submap.get_points_colors()
    if colors.max() > 1.0:
        colors = colors / 255.0


    if pcd.shape[0] != colors.shape[0]:
        n = min(pcd.shape[0], colors.shape[0])
        pcd = pcd[:n]
        colors = colors[:n]

    if pcd.size == 0:
        raise Exception("No valid points to export in submap")

    finite_mask = np.isfinite(pcd).all(axis=1)
    if not finite_mask.all():
        pcd = pcd[finite_mask]
        colors = colors[finite_mask]

    if pcd.size == 0:
        raise Exception("All points were non-finite after filtering")

    pcd_cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(pcd))
    pcd_cloud.colors = o3d.utility.Vector3dVector(colors)
    # voxel_size = 0.003
    # pcd_cloud = pcd_cloud.voxel_down_sample(voxel_size=voxel_size)

    unique_id = str(uuid.uuid4())[:8]  # Short UUID for filename (e.g., 'a1b2c3d4')

    # Create PLY in a temporary file
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".ply")
    ply_file = tmp_file.name
    tmp_file.close()
    success = o3d.io.write_point_cloud(ply_file, pcd_cloud)
    if not success:
        raise Exception("Failed to create PLY")
    return ply_file, unique_id


@app.get("/export_merged_ply")
async def export_merged_ply():
    """Export the current merged, scaled point cloud as a single PLY file.
    """
    global solver
    if solver is None:
        raise HTTPException(status_code=503, detail="Solver not initialized")

    graph_map = getattr(solver, "map", None)
    if graph_map is None or not hasattr(graph_map, "write_points_to_file"):
        raise HTTPException(status_code=500, detail="Map is not available")

    try:
        num_submaps = graph_map.get_num_submaps()
    except Exception:
        num_submaps = 0

    if num_submaps == 0:
        raise HTTPException(status_code=400, detail="No submaps available to export")

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".ply")
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        graph_map.write_points_to_file(tmp_path)
    except Exception as e:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to write merged point cloud: {e}")

    return FileResponse(
        path=tmp_path,
        media_type="application/octet-stream",
        filename="merged_pointcloud.ply",
    )
