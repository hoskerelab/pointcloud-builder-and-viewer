import os
from typing import Tuple

import cv2
import numpy as np


CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), "VGGT-SLAM", "camera_and_R_T_matrices.yml")


def load_calibration(filename: str = CALIBRATION_FILE):
    if not os.path.exists(filename):
        raise FileNotFoundError(f"Calibration file not found: {filename}")

    fs = cv2.FileStorage(filename, cv2.FileStorage_READ)
    if not fs.isOpened():
        raise RuntimeError(f"Failed to open calibration file: {filename}")

    calib = {
        "K_iToF": fs.getNode("K_iToF").mat(),
        "dist_iToF": fs.getNode("dist_iToF").mat(),
        "K_RGB": fs.getNode("K_RGB").mat(),
        "dist_RGB": fs.getNode("dist_RGB").mat(),
        "R": fs.getNode("R").mat(),
        "T": fs.getNode("T").mat(),
    }
    fs.release()
    return calib


def project_depth_onto_rgb(
    depth_mm: np.ndarray,
    K_iToF: np.ndarray,
    dist_iToF: np.ndarray,
    K_RGB: np.ndarray,
    dist_RGB: np.ndarray,
    R: np.ndarray,
    T: np.ndarray,
    rgb_shape: Tuple[int, int, int],
) -> np.ndarray:
    """Project Helios depth map onto GoPro RGB grid with iToF undistortion.

    Returns depth_proj_mm with shape (H_rgb, W_rgb) in millimetres.
    """
    H_rgb, W_rgb = rgb_shape[:2]

    if depth_mm.ndim != 2:
        raise ValueError("depth_mm must be 2D (H, W)")

    # Convert to metres
    Z = depth_mm.astype(np.float32) / 1000.0

    h, w = Z.shape
    u, v = np.meshgrid(
        np.arange(w, dtype=np.float32),
        np.arange(h, dtype=np.float32),
    )

    Z_flat = Z.reshape(-1)

    # Pack distorted pixel coords (u, v) for OpenCV undistortPoints
    pixels = np.stack((u.reshape(-1), v.reshape(-1)), axis=-1)
    pixels = pixels.reshape(-1, 1, 2)  # (N, 1, 2)

    # Undistort to normalized rays in Helios camera frame
    undistorted = cv2.undistortPoints(pixels, K_iToF, dist_iToF)
    x = undistorted[:, 0, 0]
    y = undistorted[:, 0, 1]

    # Back-project to 3D in Helios frame
    X = x * Z_flat
    Y = y * Z_flat
    points_iToF = np.vstack((X, Y, Z_flat))  # 3 x N

    # Transform to GoPro (RGB) coordinate system
    points_RGB = (R @ points_iToF) + T  # 3 x N

    # Project to GoPro image plane with distortion
    points_RGB_3d = points_RGB.T.astype(np.float32)

    proj, _ = cv2.projectPoints(
        points_RGB_3d,
        np.zeros(3, dtype=np.float32),
        np.zeros(3, dtype=np.float32),
        K_RGB,
        dist_RGB,
    )

    u_rgb = proj[:, 0, 0]
    v_rgb = proj[:, 0, 1]
    depth_z = points_RGB[2]

    depth_proj_mm = np.zeros((H_rgb, W_rgb), dtype=np.float32)

    valid = (
        (u_rgb >= 0)
        & (u_rgb < W_rgb)
        & (v_rgb >= 0)
        & (v_rgb < H_rgb)
        & (depth_z > 0)
        & np.isfinite(depth_z)
    )

    if not np.any(valid):
        return depth_proj_mm

    u_int = u_rgb[valid].astype(np.int32)
    v_int = v_rgb[valid].astype(np.int32)
    d_mm = (depth_z[valid] * 1000.0).astype(np.float32)

    # Clamp to expected operating range and keep nearest depth per pixel
    d_mm = np.clip(d_mm, 0.0, 8300.0)

    for ui, vi, di in zip(u_int, v_int, d_mm):
        current = depth_proj_mm[vi, ui]
        if current == 0 or di < current:
            depth_proj_mm[vi, ui] = di

    return depth_proj_mm
