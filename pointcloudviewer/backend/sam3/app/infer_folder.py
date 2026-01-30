import os
import time
import argparse
import psutil
import torch
import numpy as np
import cv2
import pandas as pd
from PIL import Image
from contextlib import nullcontext

import sam3
from sam3 import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor


IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff")


def find_local_ckpt() -> str:
    # sam3.__file__ -> /workspace/sam3/sam3/__init__.py (inside container)
    pkg_dir = os.path.dirname(sam3.__file__)                 # /workspace/sam3/sam3
    repo_root = os.path.abspath(os.path.join(pkg_dir, "..")) # /workspace/sam3

    candidates = [
        os.path.join(repo_root, "sam3.pt"),      # /workspace/sam3/sam3.pt
        os.path.join(pkg_dir, "sam3.pt"),        #  /workspace/sam3/sam3/sam3.pt (YOUR CASE)
    ]
    for p in candidates:
        if os.path.exists(p):
            print(f"[INFO] Using local checkpoint: {p}")
            return p

    raise FileNotFoundError(
        f"No local checkpoint found. Checked: {candidates}\n"
        f"pkg_dir={pkg_dir}, repo_root={repo_root}"
    )



def find_bpe_path(user_bpe_path: str | None) -> str:
    if user_bpe_path:
        if not os.path.exists(user_bpe_path):
            raise FileNotFoundError(f"--bpe_path not found: {user_bpe_path}")
        return user_bpe_path

    sam3_root = os.path.dirname(sam3.__file__)
    bpe_path = os.path.join(sam3_root, "assets", "bpe_simple_vocab_16e6.txt.gz")
    if not os.path.exists(bpe_path):
        raise FileNotFoundError(
            f"BPE file not found at default location: {bpe_path}\n"
            f"Fix: mount it and pass --bpe_path /path/to/bpe_simple_vocab_16e6.txt.gz"
        )
    return bpe_path


def list_images(data_dir: str):
    return sorted(
        f for f in os.listdir(data_dir)
        if f.lower().endswith(IMAGE_EXTS)
    )


@torch.inference_mode()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input_dir", required=True, help="Folder of images")
    ap.add_argument("--output_dir", required=True, help="Output folder (creates subfolders per image)")
    ap.add_argument("--prompt", required=True, help="Single text prompt for entire folder (e.g., 'rust')")
    ap.add_argument("--confidence_threshold", type=float, default=0.50)
    ap.add_argument("--bpe_path", default=None, help="Optional override path to bpe_simple_vocab_16e6.txt.gz")
    ap.add_argument("--device", default=None, help="cuda|cpu (default: auto)")
    ap.add_argument("--fp16", action="store_true", help="Use fp16 autocast on CUDA")
    args = ap.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] device = {device}")

    # Performance settings (safe)
    if device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    torch.set_float32_matmul_precision("high")

    process = psutil.Process(os.getpid())

    # Build model once (LOCAL weights, NO HF)
    bpe_path = find_bpe_path(args.bpe_path)
    ckpt_path = find_local_ckpt()

    print("[INFO] Building SAM-3 IMAGE model (local ckpt, no HF)...")
    model = build_sam3_image_model(
        bpe_path=bpe_path,
        device=device,                 #  use computed device, not undefined DEVICE
        checkpoint_path=ckpt_path,     #  local weights baked into image
        load_from_HF=False,            #  prevents HF download
        eval_mode=True,
    )
    model.eval()

    processor = Sam3Processor(model=model, confidence_threshold=args.confidence_threshold)

    image_files = list_images(args.input_dir)
    print(f"[INFO] Found {len(image_files)} images in {args.input_dir}")

    stats = []
    use_autocast = (device == "cuda") and args.fp16

    for idx, fname in enumerate(image_files):
        print(f"\n[{idx+1}/{len(image_files)}] Processing {fname}")

        img_path = os.path.join(args.input_dir, fname)
        out_dir = os.path.join(args.output_dir, os.path.splitext(fname)[0])
        os.makedirs(out_dir, exist_ok=True)

        # Load image
        image_rgb = Image.open(img_path).convert("RGB")
        image_rgb_np = np.array(image_rgb)
        image_bgr = cv2.cvtColor(image_rgb_np, cv2.COLOR_RGB2BGR)
        H, W = image_bgr.shape[:2]

        # Reset GPU stats
        if device == "cuda":
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.synchronize()

        cpu_mem_before = process.memory_info().rss / 1024**2  # MB

        # Inference timing
        start_time = time.perf_counter()

        ctx = torch.autocast(device_type="cuda", dtype=torch.float16) if use_autocast else nullcontext()
        with ctx:
            inference_state = processor.set_image(image_rgb)
            processor.reset_all_prompts(inference_state)
            inference_state = processor.set_text_prompt(state=inference_state, prompt=args.prompt)

        if device == "cuda":
            torch.cuda.synchronize()

        end_time = time.perf_counter()

        # Metrics
        infer_time = end_time - start_time
        cpu_mem_after = process.memory_info().rss / 1024**2
        cpu_mem_used = cpu_mem_after - cpu_mem_before

        if device == "cuda":
            gpu_mem_used = torch.cuda.memory_allocated() / 1024**2
            gpu_mem_peak = torch.cuda.max_memory_allocated() / 1024**2
        else:
            gpu_mem_used = 0.0
            gpu_mem_peak = 0.0

        # Save masks
        masks = inference_state.get("masks", None)
        merged_mask = np.zeros((H, W), dtype=np.uint8)

        if masks is not None and hasattr(masks, "shape") and masks.shape[0] > 0:
            for i in range(masks.shape[0]):
                mask = masks[i].detach().cpu().numpy()
                if mask.ndim == 3:
                    mask = mask.squeeze(0)
                mask = (mask > 0).astype(np.uint8) * 255
                merged_mask[mask > 0] = 255

        cv2.imwrite(os.path.join(out_dir, "mask_merged.png"), merged_mask)

        # Overlay
        overlay = image_bgr.copy()
        overlay[merged_mask == 255] = (0, 0, 255)
        overlay = cv2.addWeighted(image_bgr, 0.7, overlay, 0.3, 0)
        cv2.imwrite(os.path.join(out_dir, "overlay.png"), overlay)

        stats.append({
            "image": fname,
            "height": H,
            "width": W,
            "prompt": args.prompt,
            "confidence_threshold": args.confidence_threshold,
            "inference_time_sec": round(infer_time, 4),
            "cpu_ram_used_mb": round(cpu_mem_used, 2),
            "gpu_mem_used_mb": round(gpu_mem_used, 2),
            "gpu_mem_peak_mb": round(gpu_mem_peak, 2),
        })

        print(
            f"   {infer_time:.3f}s | "
            f"CPU Δ {cpu_mem_used:.1f} MB | "
            f"GPU {gpu_mem_used:.1f} MB (peak {gpu_mem_peak:.1f} MB)"
        )

    df = pd.DataFrame(stats)
    csv_path = os.path.join(args.output_dir, "inference_stats.csv")
    df.to_csv(csv_path, index=False)

    print("\n[DONE] Batch inference complete")
    print(f"[INFO] Stats saved to: {csv_path}")


if __name__ == "__main__":
    main()
