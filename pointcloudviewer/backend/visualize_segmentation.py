# backend/visualize_segmentation.py
import os
import json
import numpy as np
import cv2
from PIL import Image
from segmentation import engine # Access the singleton engine directly

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_IMAGE = os.path.join(BASE_DIR, "dummy.jpg")
OUTPUT_IMAGE = os.path.join(BASE_DIR, "dummy_debug.png")

def run_debug_visualization(image_path, prompt):
    if not os.path.exists(image_path):
        print("❌ Image not found.")
        return

    print(f"📸 Processing: {image_path}")
    image = Image.open(image_path).convert("RGB")
    img_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    overlay = img_cv.copy()
    
    # 1. FLORENCE-2 (Text -> Box)
    print("🔍 Step 1: Running Florence-2 for Bounding Box...")
    task_prompt = "<CAPTION_TO_PHRASE_GROUNDING>"
    text_input = task_prompt + prompt
    
    inputs = engine.florence_processor(text=text_input, images=image, return_tensors="pt").to(engine.florence_model.device)
    generated_ids = engine.florence_model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=1024,
        num_beams=3,
        use_cache=False
    )
    generated_text = engine.florence_processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    parsed = engine.florence_processor.post_process_generation(
        generated_text, task=task_prompt, image_size=(image.width, image.height)
    )
    
    bboxes = parsed.get(task_prompt, {}).get('bboxes', [])
    labels = parsed.get(task_prompt, {}).get('labels', [])
    
    relevant_boxes = []
    for i, label in enumerate(labels):
        if prompt.lower() in label.lower():
            relevant_boxes.append(bboxes[i])
            
            # DRAW BOX (Cyan)
            x1, y1, x2, y2 = map(int, bboxes[i])
            cv2.rectangle(overlay, (x1, y1), (x2, y2), (255, 255, 0), 3)
            cv2.putText(overlay, f"Florence: {label}", (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

    if not relevant_boxes:
        print("⚠️ Florence found NO matching boxes.")
        cv2.imwrite(OUTPUT_IMAGE, overlay)
        return

    # 2. SAM 2 (Box -> Mask)
    print(f"🔍 Step 2: Running SAM2 on {len(relevant_boxes)} boxes...")
    engine.predictor.set_image(np.array(image))
    input_boxes = np.array(relevant_boxes)
    
    masks, scores, _ = engine.predictor.predict(
        point_coords=None,
        point_labels=None,
        box=input_boxes,
        multimask_output=False
    )
    
    # 3. Draw Masks (Red)
    for i, mask in enumerate(masks):
        # Draw Mask Outline
        mask_uint8 = (mask[0] * 255).astype(np.uint8)
        contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(overlay, contours, -1, (0, 0, 255), 2)
        
        # Fill
        pts = contours[0] if len(contours) > 0 else None
        if pts is not None:
            cv2.fillPoly(overlay, [pts], (0, 0, 255))

    # Save
    cv2.addWeighted(overlay, 0.5, img_cv, 0.5, 0, img_cv)
    cv2.imwrite(OUTPUT_IMAGE, img_cv)
    print(f"✅ Debug visualization saved to: {OUTPUT_IMAGE}")

if __name__ == "__main__":
    run_debug_visualization(INPUT_IMAGE, "door")