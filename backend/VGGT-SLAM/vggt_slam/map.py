import os
import numpy as np
import torch
import open3d as o3d
import cv2
from scipy.spatial.transform import Rotation as R

class GraphMap:
    def __init__(self):
        self.submaps = dict()
        self.global_scale = 1.0
    
    def get_num_submaps(self):
        return len(self.submaps)

    def add_submap(self, submap):
        submap_id = submap.get_id()
        self.submaps[submap_id] = submap
    
    def get_largest_key(self):
        if len(self.submaps) == 0:
            return -1
        return max(self.submaps.keys())
    
    def get_submap(self, id):
        return self.submaps[id]

    def get_latest_submap(self):
        return self.get_submap(self.get_largest_key())
    
    def retrieve_best_score_frame(self, query_vector, current_submap_id, ignore_last_submap=True):
        overall_best_score = 1000
        overall_best_submap_id = 0
        overall_best_frame_index = 0
        # search for best image to target image
        for submap_key in self.submaps.keys():
            if submap_key == current_submap_id:
                continue

            if ignore_last_submap and (submap_key == current_submap_id-1):
                continue

            else:
                submap = self.submaps[submap_key]
                submap_embeddings = submap.get_all_retrieval_vectors()
                scores = []
                for embedding in submap_embeddings:
                    score = torch.linalg.norm(embedding-query_vector)
                    scores.append(score.item())
                
                best_score_id = np.argmin(scores)
                best_score = scores[best_score_id]

                if best_score < overall_best_score:
                    overall_best_score = best_score
                    overall_best_submap_id = submap_key
                    overall_best_frame_index = best_score_id

        return overall_best_score, overall_best_submap_id, overall_best_frame_index

    def get_frames_from_loops(self, loops):
        frames = []
        for detected_loop in loops:
            frames.append(self.submaps[detected_loop.detected_submap_id].get_frame_at_index(detected_loop.detected_submap_frame))
        
        return frames
    
    def update_submap_homographies(self, graph):
        for submap_key in self.submaps.keys():
            submap = self.submaps[submap_key]
            submap.set_reference_homography(graph.get_homography(submap_key).matrix())
    
    def get_submaps(self):
        return self.submaps.values()

    def set_global_scale(self, scale: float):
        """Set a global scale factor applied on export.
        """
        self.global_scale = float(scale)

    def ordered_submaps_by_key(self):
        for k in sorted(self.submaps):
            yield self.submaps[k]

    def refine_points_with_depth(self):
        """Rebuild submap point clouds using captured depth + predicted poses.
        """

        if self.get_num_submaps() == 0:
            return

        scale = float(self.global_scale) if self.global_scale != 0 else 1.0

        for submap in self.ordered_submaps_by_key():
            depth_paths = getattr(submap, "depth_paths", None)
            poses = getattr(submap, "poses", None)
            pointclouds = getattr(submap, "pointclouds", None)
            intrinsics = getattr(submap, "vggt_intrinscs", None)
            colors = getattr(submap, "colors", None)
            conf = getattr(submap, "conf", None)
            conf_masks = getattr(submap, "conf_masks", None)

            # Require poses, intrinsics, and depth paths to rebuild points
            if depth_paths is None or poses is None or intrinsics is None:
                continue

            last_non_loop = submap.get_last_non_loop_frame_index()
            if last_non_loop is None:
                continue

            # Ensure we have a pointcloud array to write into
            if pointclouds is None and colors is not None:
                S, Hc, Wc, _ = colors.shape
                pointclouds = np.zeros((S, Hc, Wc, 3), dtype=np.float32)
                submap.pointclouds = pointclouds

            if pointclouds is None:
                continue

            num_frames = min(len(depth_paths), last_non_loop + 1, pointclouds.shape[0])
            if num_frames <= 0:
                continue

            for frame_idx in range(num_frames):
                depth_path = depth_paths[frame_idx]
                if (depth_path is None) or (not os.path.exists(depth_path)):
                    pointclouds[frame_idx] = 0.0
                    if conf is not None:
                        conf[frame_idx] = 0.0
                    if conf_masks is not None:
                        conf_masks[frame_idx] = False
                    continue

                try:
                    captured_depth_mm = np.load(depth_path)
                except Exception:
                    pointclouds[frame_idx] = 0.0
                    if conf is not None:
                        conf[frame_idx] = 0.0
                    if conf_masks is not None:
                        conf_masks[frame_idx] = False
                    continue

                if captured_depth_mm.ndim > 2:
                    captured_depth_mm = np.squeeze(captured_depth_mm)
                if captured_depth_mm.ndim != 2:
                    # Invalid depth shape; drop existing points for this frame.
                    pointclouds[frame_idx] = 0.0
                    if conf is not None:
                        conf[frame_idx] = 0.0
                    if conf_masks is not None:
                        conf_masks[frame_idx] = False
                    continue

                # Target resolution for points/colors in this submap
                H, W = pointclouds.shape[1:3]

                # Resize captured depth to match color resolution
                depth_resized = cv2.resize(
                    captured_depth_mm,
                    (W, H),
                    interpolation=cv2.INTER_NEAREST,
                )

                # Valid metric depth in millimeters
                mask_valid = (depth_resized > 0) & (depth_resized < 8300)
                if not np.any(mask_valid):
                    pointclouds[frame_idx] = 0.0
                    if conf is not None:
                        conf[frame_idx] = 0.0
                    if conf_masks is not None:
                        conf_masks[frame_idx] = False
                    continue

                # Convert to meters, then to internal units via global scale
                depth_m = depth_resized.astype(np.float32) * 1e-3
                depth_internal = depth_m / scale

                # Unproject only valid pixels using predicted intrinsics
                K = intrinsics[frame_idx]
                fx, fy = K[0, 0], K[1, 1]
                cx, cy = K[0, 2], K[1, 2]

                ys, xs = np.where(mask_valid)
                if ys.size == 0:
                    pointclouds[frame_idx] = 0.0
                    if conf is not None:
                        conf[frame_idx] = 0.0
                    if conf_masks is not None:
                        conf_masks[frame_idx] = False
                    continue

                z = depth_internal[ys, xs]
                x_cam = (xs - cx) / fx * z
                y_cam = (ys - cy) / fy * z
                pts_cam = np.stack([x_cam, y_cam, z], axis=1).astype(np.float32)  # (N, 3)

                # Camera pose for this frame (cam->world)
                cam_to_world = poses[frame_idx]
                if cam_to_world.shape == (3, 4):
                    T = np.eye(4, dtype=np.float32)
                    T[:3, :4] = cam_to_world
                else:
                    T = cam_to_world.astype(np.float32)

                # Transform to world coordinates
                pts_cam_h = np.concatenate(
                    [pts_cam, np.ones((pts_cam.shape[0], 1), dtype=np.float32)], axis=1
                )
                pts_world_h = (T @ pts_cam_h.T).T
                pts_world = pts_world_h[:, :3] / pts_world_h[:, 3:4]

                # Write back into the submap's pointcloud grid for this frame
                frame_points = np.zeros((H, W, 3), dtype=np.float32)
                frame_points[ys, xs, :] = pts_world
                pointclouds[frame_idx] = frame_points

                if conf is not None:
                    conf[frame_idx] = mask_valid.astype(np.float32)
                if conf_masks is not None:
                    conf_masks[frame_idx] = mask_valid

            # Set a fixed threshold so that conf >= 0.5 corresponds to
            # valid captured-depth pixels only.
            if conf is not None:
                submap.conf = conf
                submap.conf_threshold = 0.5
            if conf_masks is not None:
                submap.conf_masks = conf_masks

    def write_poses_to_file(self, file_name):
        with open(file_name, "w") as f:
            for submap in self.ordered_submaps_by_key():
                poses = submap.get_all_poses_world(ignore_loop_closure_frames=True)
                frame_ids = submap.get_frame_ids()
                assert len(poses) == len(frame_ids), "Number of provided poses and number of frame ids do not match"
                for frame_id, pose in zip(frame_ids, poses):
                    x, y, z = pose[0:3, 3] * self.global_scale
                    rotation_matrix = pose[0:3, 0:3]
                    quaternion = R.from_matrix(rotation_matrix).as_quat() # x, y, z, w
                    output = np.array([float(frame_id), x, y, z, *quaternion])
                    f.write(" ".join(f"{v:.8f}" for v in output) + "\n")

    def save_framewise_pointclouds(self, file_name):
        os.makedirs(file_name, exist_ok=True)
        for submap in self.ordered_submaps_by_key():
            pointclouds, frame_ids, conf_masks = submap.get_points_list_in_world_frame(ignore_loop_closure_frames=True)
            for frame_id, pointcloud, conf_masks in zip(frame_ids, pointclouds, conf_masks):
                # save scaled pcd as numpy array
                np.savez(f"{file_name}/{frame_id}.npz", pointcloud=pointcloud * self.global_scale, mask=conf_masks)
                

    def write_points_to_file(self, file_name):
        pcd_all = []
        colors_all = []
        for submap in self.ordered_submaps_by_key():
            pcd = submap.get_points_in_world_frame()
            pcd = pcd.reshape(-1, 3)
            pcd_all.append(pcd)
            colors_all.append(submap.get_points_colors())
        pcd_all = np.concatenate(pcd_all, axis=0)
        # Apply global scale to exported points
        pcd_all = pcd_all * self.global_scale
        colors_all = np.concatenate(colors_all, axis=0)
        if colors_all.max() > 1.0:
            colors_all = colors_all / 255.0
        pcd_all = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(pcd_all))
        pcd_all.colors = o3d.utility.Vector3dVector(colors_all)
        o3d.io.write_point_cloud(file_name, pcd_all)