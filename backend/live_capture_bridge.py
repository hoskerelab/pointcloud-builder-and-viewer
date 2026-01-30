import argparse
import asyncio
import base64
import io
import json
import os
import signal
import sys
import threading
from typing import Optional, Tuple

import cv2
import numpy as np

from depth_projection import CALIBRATION_FILE, load_calibration, project_depth_onto_rgb

try:
    import websockets  # type: ignore
except ImportError:  # pragma: no cover - runtime dependency
    websockets = None  # type: ignore

try:
    from open_gopro import WiredGoPro, constants  # type: ignore
except ImportError:  # pragma: no cover
    WiredGoPro = None  # type: ignore
    constants = None  # type: ignore

try:
    from arena_api.system import system  # type: ignore
    from arena_api.buffer import BufferFactory  # type: ignore
    from arena_api.enums import PixelFormat  # type: ignore
except ImportError:  # pragma: no cover
    system = None  # type: ignore
    BufferFactory = None  # type: ignore
    PixelFormat = None  # type: ignore


def get_backend_ws_url(default: str = "ws://127.0.0.1:8000/ws/upload") -> str:
    """Resolve backend WebSocket URL from environment or use default.
    """
    return os.environ.get("BACKEND_WS_URL", default)


_stop = False


_latest_frame: Optional[np.ndarray] = None
_latest_frame_lock = threading.Lock()


_latest_depth_mm: Optional[np.ndarray] = None
_latest_depth_lock = threading.Lock()


def _handle_sigint(signum, frame):  # pragma: no cover - signal handler
    """Graceful stop when run from a terminal (Ctrl+C).
    """
    global _stop
    _stop = True


signal.signal(signal.SIGINT, _handle_sigint)



async def initialize_gopro_webcam():
    if WiredGoPro is None or constants is None:
        raise RuntimeError("open_gopro is not installed; cannot use GoPro webcam mode")

    gopro = WiredGoPro()
    await gopro.open()
    await gopro.http_command.webcam_start(
        resolution=constants.WebcamResolution.RES_1080,
        fov=constants.WebcamFOV.NARROW,
        port=8554,
        protocol=constants.WebcamProtocol.TS,
    )
    await asyncio.sleep(3)
    return gopro


def open_gopro_stream() -> cv2.VideoCapture:
    cap = cv2.VideoCapture(
        "udp://@:8554?overrun_nonfatal=1&fifo_size=50000", cv2.CAP_FFMPEG
    )
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FPS, 30)

    for _ in range(30):
        cap.read()
    return cap


def _start_capture_thread(cap: cv2.VideoCapture) -> threading.Thread:
    """Start a background thread that continuously grabs frames.
    """

    def _loop() -> None:
        global _latest_frame
        while not _stop:
            ok, frame = cap.read()
            if not ok:
                continue
            with _latest_frame_lock:
                _latest_frame = frame

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t


def initialize_helios2():
    if system is None or PixelFormat is None:
        raise RuntimeError("arena_api is not installed; cannot use Helios2")

    devices = system.create_device()
    if not devices:
        raise RuntimeError("No Helios2 device found")

    device = devices[0]
    tl_nodemap = device.tl_stream_nodemap
    tl_nodemap["StreamAutoNegotiatePacketSize"].value = True
    tl_nodemap["StreamPacketResendEnable"].value = True

    nodemap = device.nodemap
    nodemap["PixelFormat"].value = PixelFormat.Coord3D_ABCY16
    nodemap["Scan3dOperatingMode"].value = "Distance8300mmMultiFreq"
    nodemap["Scan3dSpatialFilterEnable"].value = True
    nodemap["Scan3dConfidenceThresholdEnable"].value = True

    nodemap["Scan3dCoordinateSelector"].value = "CoordinateC"
    z_scale = nodemap["Scan3dCoordinateScale"].value
    z_offset = nodemap["Scan3dCoordinateOffset"].value

    return device, z_scale, z_offset


def _start_helios_thread(device, z_scale: float, z_offset: float) -> threading.Thread:
    """Start a background thread that continuously grabs Helios depth.
    """

    def _loop() -> None:
        """Continuously grab Coord3D_ABCY16 depth using buffer.pdata.
        """

        global _latest_depth_mm

        try:
            with device.start_stream(4):  # type: ignore[attr-defined]
                first_logged = False
                while not _stop:
                    try:
                        buffer = device.get_buffer(timeout=2000)  # type: ignore[attr-defined]
                    except Exception:
                        continue

                    try:
                        height = int(buffer.height)
                        width = int(buffer.width)
                        channels_per_pixel = int(buffer.bits_per_pixel / 16)

                        # Interpret raw 16-bit data via ctypes
                        import ctypes

                        pdata_16 = ctypes.cast(
                            buffer.pdata, ctypes.POINTER(ctypes.c_uint16)
                        )
                        arr = np.ctypeslib.as_array(
                            pdata_16,
                            shape=(height * width * channels_per_pixel,),
                        )
                        if arr.size != height * width * channels_per_pixel:
                            device.requeue_buffer(buffer)  # type: ignore[attr-defined]
                            continue
                        data = arr.reshape(height, width, channels_per_pixel)

                        # Z channel is index 2 (CoordinateC)
                        depth_raw = data[:, :, 2].astype(np.float32)
                        depth_mm = depth_raw * float(z_scale) + float(z_offset)

                        with _latest_depth_lock:
                            _latest_depth_mm = depth_mm

                        if not first_logged:
                            first_logged = True
                            print(
                                f"Helios thread: captured depth frame {width}x{height}, "
                                f"dtype={depth_mm.dtype}"
                            )
                    except Exception:
                        pass
                    finally:
                        try:
                            device.requeue_buffer(buffer)  # type: ignore[attr-defined]
                        except Exception:
                            pass
        except Exception:
            print("Helios thread: failed to start stream")
            return

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t


def helios_grab_depth_mm(device, z_scale: float, z_offset: float) -> Optional[np.ndarray]:
    """Grab one Helios frame and convert to depth in mm.

    Returns a 2D array (H, W) in millimetres, or None on failure.
    """
    if BufferFactory is None:
        return None

    with device.start_stream():  # type: ignore[attr-defined]
        try:
            buffer = device.get_buffer(timeout=200)  # type: ignore[attr-defined]
        except Exception:
            return None

        try:
            copied = BufferFactory.copy(buffer)  # type: ignore[operator]
            device.requeue_buffer(buffer)  # type: ignore[attr-defined]
        except Exception:
            return None

    try:
        data_bytes = bytes(copied)
    except TypeError:
        return None

    data = np.frombuffer(data_bytes, dtype=np.uint16)
    if data.size % 4 != 0:
        return None
    data = data.reshape(-1, 4)
    depth_raw = data[:, 2].astype(np.int32)
    depth_m = depth_raw * z_scale + z_offset
    depth_mm = np.clip(depth_m * 1000.0, 0, 8300).astype(np.float32)

    return depth_mm


 


def colorize_depth(depth_mm: np.ndarray) -> np.ndarray:
    """Create a colored depth visualization from a depth map in mm."""
    if depth_mm.size == 0:
        return np.zeros((1, 1, 3), dtype=np.uint8)

    depth = depth_mm.copy()
    depth[~np.isfinite(depth)] = 0
    depth = np.clip(depth, 0, 8300)
    if depth.max() <= 0:
        return np.zeros((*depth.shape, 3), dtype=np.uint8)

    depth_norm = (depth / depth.max() * 255.0).astype(np.uint8)
    colored = cv2.applyColorMap(depth_norm, cv2.COLORMAP_TURBO)
    return colored


async def stream_gopro_only(backend_ws_url: Optional[str] = None, preview_only: bool = False):
    if websockets is None and not preview_only:
        raise RuntimeError("websockets package is required for live capture bridge")

    global _latest_frame
    _latest_frame = None

    gopro = await initialize_gopro_webcam()
    cap = open_gopro_stream()
    capture_thread = _start_capture_thread(cap)

    if preview_only:
        # Preview-only mode
        while not _stop:
            await asyncio.sleep(0.01)
            with _latest_frame_lock:
                frame = None if _latest_frame is None else _latest_frame.copy()
            if frame is None:
                continue

            ok_jpg, jpg = cv2.imencode(".jpg", frame)
            if ok_jpg:
                msg = {
                    "type": "rgb",
                    "jpeg_b64": base64.b64encode(jpg).decode("ascii"),
                }
                sys.stdout.write(json.dumps(msg) + "\n")
                sys.stdout.flush()
    else:
        url = backend_ws_url or get_backend_ws_url()

        async with websockets.connect(url) as ws:  # type: ignore[attr-defined]
            await ws.send("config:use_depth_maps:0")

            await ws.send("config:live_stream:1")

            while not _stop:
                # Yield to event loop
                await asyncio.sleep(0.0)
                with _latest_frame_lock:
                    frame = None if _latest_frame is None else _latest_frame.copy()
                if frame is None:
                    await asyncio.sleep(0.01)
                    continue

                ok_jpg_backend, jpg_backend = cv2.imencode(
                    ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80]
                )
                if ok_jpg_backend:
                    await ws.send(jpg_backend.tobytes())

                ok_jpg_preview, jpg_preview = cv2.imencode(".jpg", frame)
                if ok_jpg_preview:
                    msg = {
                        "type": "rgb",
                        "jpeg_b64": base64.b64encode(jpg_preview).decode("ascii"),
                    }
                    sys.stdout.write(json.dumps(msg) + "\n")
                    sys.stdout.flush()

                # Throttle; ~30 fps
                await asyncio.sleep(1.0 / 30.0)

            try:
                await ws.send("done")
            except Exception:
                pass

    # Cleanup GoPro
    try:
        await gopro.http_command.webcam_stop()  # type: ignore[union-attr]
        if constants is not None:
            try:
                await gopro.http_command.mode(  # type: ignore[union-attr]
                    constants.Mode.Video,
                    constants.SubMode.Video.Standard,
                )
            except Exception:
                pass
    except Exception:
        pass

    cap.release()


async def stream_gopro_helios(backend_ws_url: Optional[str] = None, preview_only: bool = False):
    if websockets is None and not preview_only:
        raise RuntimeError("websockets package is required for live capture bridge")

    calib = load_calibration(CALIBRATION_FILE)
    K_iToF = calib["K_iToF"]
    dist_iToF = calib["dist_iToF"]
    K_RGB = calib["K_RGB"]
    dist_RGB = calib["dist_RGB"]
    R = calib["R"]
    T = calib["T"]

    global _latest_frame, _latest_depth_mm
    _latest_frame = None
    _latest_depth_mm = None

    gopro = await initialize_gopro_webcam()
    cap = open_gopro_stream()
    capture_thread = _start_capture_thread(cap)

    device, z_scale, z_offset = initialize_helios2()
    helios_thread = _start_helios_thread(device, z_scale, z_offset)

    if preview_only:
        # Preview-only
        while not _stop:
            await asyncio.sleep(0.01)
            with _latest_frame_lock:
                frame = None if _latest_frame is None else _latest_frame.copy()
            if frame is None:
                continue

            depth_img = None
            with _latest_depth_lock:
                depth_flat_mm = None if _latest_depth_mm is None else _latest_depth_mm.copy()

            if depth_flat_mm is not None and depth_flat_mm.ndim == 2:
                depth = depth_flat_mm.copy()
                depth[~np.isfinite(depth)] = 0
                depth = np.clip(depth, 0, 8300)
                if depth.max() > 0:
                    depth_norm = (depth / depth.max() * 255.0).astype(np.uint8)
                else:
                    depth_norm = np.zeros(depth.shape, dtype=np.uint8)
                depth_img = depth_norm

            ok_jpg, jpg = cv2.imencode(".jpg", frame)
            depth_jpeg_b64 = None
            if depth_img is not None:
                ok_djpg, d_jpg = cv2.imencode(".jpg", depth_img)
                if ok_djpg:
                    depth_jpeg_b64 = base64.b64encode(d_jpg).decode("ascii")

            if ok_jpg:
                msg = {
                    "type": "rgbd",
                    "rgb_jpeg_b64": base64.b64encode(jpg).decode("ascii"),
                }
                if depth_jpeg_b64 is not None:
                    msg["depth_jpeg_b64"] = depth_jpeg_b64
                sys.stdout.write(json.dumps(msg) + "\n")
                sys.stdout.flush()
    else:
        url = backend_ws_url or get_backend_ws_url()

        async with websockets.connect(url) as ws:  # type: ignore[attr-defined]
            await ws.send("config:use_depth_maps:1")
            await ws.send("config:live_stream:1")

            while not _stop:
                await asyncio.sleep(0.0)
                with _latest_frame_lock:
                    frame = None if _latest_frame is None else _latest_frame.copy()
                if frame is None:
                    await asyncio.sleep(0.01)
                    continue

                with _latest_depth_lock:
                    depth_flat_mm = None if _latest_depth_mm is None else _latest_depth_mm.copy()
                if depth_flat_mm is None or depth_flat_mm.ndim != 2:
                    await asyncio.sleep(0.01)
                    continue

                depth_proj_mm = project_depth_onto_rgb(
                    depth_flat_mm,
                    K_iToF,
                    dist_iToF,
                    K_RGB,
                    dist_RGB,
                    R,
                    T,
                    frame.shape,
                )

                # Send RGB JPEG then depth .npy bytes to backend. JPEG
                # keeps each message comfortably under the default 1 MiB
                # frame size limit used by many WebSocket servers.
                ok_jpg_backend, jpg_backend = cv2.imencode(
                    ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80]
                )
                if ok_jpg_backend:
                    await ws.send(jpg_backend.tobytes())

                buf = io.BytesIO()
                np.save(buf, depth_proj_mm.astype(np.float32))
                await ws.send(buf.getvalue())

                # Previews: RGB plus grayscale depth intensity
                ok_jpg_preview, jpg_preview = cv2.imencode(".jpg", frame)
                depth = depth_proj_mm.copy()
                depth[~np.isfinite(depth)] = 0
                depth = np.clip(depth, 0, 8300)
                depth_jpeg_b64 = None
                if depth.size > 0 and depth.max() > 0:
                    depth_norm = (depth / depth.max() * 255.0).astype(np.uint8)
                else:
                    depth_norm = np.zeros(depth.shape, dtype=np.uint8)
                ok_djpg, d_jpg = cv2.imencode(".jpg", depth_norm)
                if ok_djpg:
                    depth_jpeg_b64 = base64.b64encode(d_jpg).decode("ascii")

                if ok_jpg_preview:
                    msg = {
                        "type": "rgbd",
                        "rgb_jpeg_b64": base64.b64encode(jpg_preview).decode("ascii"),
                    }
                    if depth_jpeg_b64 is not None:
                        msg["depth_jpeg_b64"] = depth_jpeg_b64
                    sys.stdout.write(json.dumps(msg) + "\n")
                    sys.stdout.flush()

                # Throttle to ~30 fps
                await asyncio.sleep(1.0 / 30.0)

            try:
                await ws.send("done")
            except Exception:
                pass

    # Cleanup
    try:
        await gopro.http_command.webcam_stop()  # type: ignore[union-attr]
        if constants is not None:
            try:
                await gopro.http_command.mode(  # type: ignore[union-attr]
                    constants.Mode.Video,
                    constants.SubMode.Video.Standard,
                )
            except Exception:
                pass
    except Exception:
        pass
    cap.release()


def main():  # pragma: no cover - entrypoint
    parser = argparse.ArgumentParser(description="Live capture bridge for GoPro and Helios2")
    parser.add_argument("--mode", choices=["gopro", "gopro_helios"], required=True)
    parser.add_argument("--backend-url", type=str, default=None, help="Backend WebSocket URL (overrides BACKEND_WS_URL env)")
    parser.add_argument("--preview-only", action="store_true", help="Preview-only mode (no backend streaming)")
    args = parser.parse_args()

    if args.mode == "gopro":
        asyncio.run(stream_gopro_only(args.backend_url, preview_only=args.preview_only))
    else:
        asyncio.run(stream_gopro_helios(args.backend_url, preview_only=args.preview_only))


if __name__ == "__main__":  # pragma: no cover
    main()
