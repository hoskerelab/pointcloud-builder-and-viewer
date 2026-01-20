# backend/segmentation.py

import torch
import numpy as np
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from transformers import AutoProcessor, AutoModelForCausalLM
from transformers import dynamic_module_utils # Needed for the patch
from unittest.mock import patch # Needed for the patch
import cv2
import os

# SETTINGS
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAM2_CHECKPOINT = os.path.join(BASE_DIR, "checkpoints", "sam2_hiera_large.pt")
SAM2_CONFIG = "sam2_hiera_l.yaml"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Monkey patching for Mac Silicon to bypass flash_attn requirement
if DEVICE == "mps":
    print("Detected macOS with MPS support. Will apply patch to bypass flash_attn requirement.")
    original_get_imports = dynamic_module_utils.get_imports

    def fixed_get_imports(filename):
        # Call the SAVED original function, avoiding recursion
        imports = original_get_imports(filename)
        if "flash_attn" in imports:
            imports.remove("flash_attn")
        return imports

    # Apply patch globally (safer for persistence)
    dynamic_module_utils.get_imports = fixed_get_imports

class SegmentationEngine:
    def __init__(self):
        print(f"Initializing Segmentation Engine on {DEVICE}...")
        self.sam2_model = build_sam2(SAM2_CONFIG, SAM2_CHECKPOINT, device=DEVICE)
        self.predictor = SAM2ImagePredictor(self.sam2_model)
        
        print("Loading Florence-2...")
        self.florence_model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-base", 
            trust_remote_code=True
        ).to(DEVICE)

        self.florence_processor = AutoProcessor.from_pretrained("microsoft/Florence-2-base", trust_remote_code=True)
        print("Models loaded.")

    def _pad_box(self, box, w, h, padding_pct=0.1):
        """
        Expands box by a percentage, strictly clamped to image boundaries.
        """
        x1, y1, x2, y2 = box
        bw = x2 - x1
        bh = y2 - y1
        
        pad_x = bw * padding_pct
        pad_y = bh * padding_pct
        
        # 1. Expand
        nx1 = x1 - pad_x
        ny1 = y1 - pad_y
        nx2 = x2 + pad_x
        ny2 = y2 + pad_y
        
        # 2. Clamp (Robustness Check)
        nx1 = max(0, min(w, nx1))
        ny1 = max(0, min(h, ny1))
        nx2 = max(0, min(w, nx2))
        ny2 = max(0, min(h, ny2))
        
        # 3. Validity Check (prevent 0-width boxes)
        if nx2 <= nx1: nx2 = nx1 + 1
        if ny2 <= ny1: ny2 = ny1 + 1
        
        return [nx1, ny1, nx2, ny2]

    def segment_from_text(self, image_path: str, text_prompt: str, debug: bool = False):
        image = Image.open(image_path).convert("RGB")
        w, h = image.size
        
        # --- 1. Florence-2 (Text -> Box) ---
        task_prompt = "<CAPTION_TO_PHRASE_GROUNDING>"
        text_input = task_prompt + text_prompt 
        inputs = self.florence_processor(text=text_input, images=image, return_tensors="pt").to(DEVICE)
        
        generated_ids = self.florence_model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=1024,
            num_beams=3,
            use_cache=False
        )
        generated_text = self.florence_processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed_result = self.florence_processor.post_process_generation(
            generated_text, task=task_prompt, image_size=(w, h)
        )
        
        raw_bboxes = parsed_result.get(task_prompt, {}).get('bboxes', [])
        labels = parsed_result.get(task_prompt, {}).get('labels', [])
        
        final_boxes = []
        debug_boxes = []
        
        for i, label in enumerate(labels):
            if text_prompt.lower() in label.lower():
                # Apply Padding
                padded_box = self._pad_box(raw_bboxes[i], w, h, padding_pct=0.10)
                final_boxes.append(padded_box)
                
                if debug:
                    debug_boxes.append({
                        "label": label,
                        "box_2d": [raw_bboxes[i][0]/w, raw_bboxes[i][1]/h, raw_bboxes[i][2]/w, raw_bboxes[i][3]/h]
                    })

        if not final_boxes:
            return []

        # --- 2. SAM 2 (Box -> Mask) ---
        self.predictor.set_image(np.array(image))
        input_boxes = np.array(final_boxes)
        
        masks, scores, _ = self.predictor.predict(
            point_coords=None,
            point_labels=None,
            box=input_boxes,
            multimask_output=False
        )
        
        # --- 3. High Fidelity Polygons ---
        results = []
        for i, mask in enumerate(masks):
            mask_uint8 = (mask[0] * 255).astype(np.uint8)
            
            # RETR_LIST retrieves all contours (outer and holes)
            # If you wanted holes specifically, you'd use RETR_CCOMP or RETR_TREE
            contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for contour in contours:
                if len(contour) < 3: continue
                
                # --- FIDELITY CONTROL ---
                # Low value (e.g. 0.0005) = Very high fidelity, curves look real
                # High value (e.g. 0.01) = Low poly, hexagon-like
                epsilon = 0.0005 * cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, epsilon, True)
                
                # Normalize points to 0-1
                points = [{"x": float(pt[0][0])/w, "y": float(pt[0][1])/h, "z": 0} for pt in approx]
                
                entry = {
                    "label": text_prompt,
                    "confidence": float(scores[i]),
                    "points": points,
                    "area": cv2.contourArea(contour)
                }
                
                if debug:
                    entry["debug_box"] = debug_boxes[i] if i < len(debug_boxes) else None
                
                results.append(entry)
                
        return results

# Singleton
engine = SegmentationEngine()

def run_segmentation(image_path, prompt, debug=False):
    return engine.segment_from_text(image_path, prompt, debug)