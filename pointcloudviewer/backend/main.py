# backend/main.py

import os
import sys
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import logic modules
from segmentation import run_segmentation
from fusion import run_3d_fusion

app = FastAPI()

# --- CONFIGURATION ---
# Allow Electron to communicate with Python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dynamic Path Resolution
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Hardcoded Scene Path for now (Update this if you want to switch scenes!)
# Checks for 'example_scene' inside backend, otherwise looks for 'sceneCOLMAP' in root
POSSIBLE_SCENES = [
    os.path.join(BASE_DIR, "example_scene"),
    os.path.abspath(os.path.join(BASE_DIR, "../sceneCOLMAP"))
]
SCENE_PATH = next((p for p in POSSIBLE_SCENES if os.path.exists(p)), None)

class ChatRequest(BaseModel):
    message: str
    force: bool = False
    
@app.post("/chat")
async def chat_handler(req: ChatRequest):
    """
    Central Command Handler for the Electron Chat Interface.
    Parses text commands and triggers AI pipelines.
    """
    message = req.message.strip()
    
    if message.lower().startswith("segment 3d"):
        prompt = message[10:].strip()
        if not SCENE_PATH:
            return {"message": "Error: No scene data found."}

        print(f"[API] Request: '{prompt}' (Force Recompute: {req.force})")

        try:
            # Pass the force flag down
            fusion_result = run_3d_fusion(SCENE_PATH, prompt, force_recompute=req.force)
            
            point_count = len(fusion_result.get('point_indices', []))
            
            return {
                "message": f"Segmentation Complete. Loaded {point_count} points.",
                "command": {
                    "type": "segmentation",
                    "action": "update3D",
                    "params": fusion_result 
                }
            }
        except Exception as e:
            traceback.print_exc()
            return {"message": f"Error: {str(e)}"}

    # --- COMMAND 2: 2D DEBUG (Single Image) ---
    # Usage: "segment door" (runs on dummy.jpg or specific test image)
    elif message.lower().startswith("segment"):
        prompt = message[7:].strip()
        
        # Use dummy.jpg for quick debug checks
        test_image = os.path.join(BASE_DIR, "dummy.jpg")
        
        if not os.path.exists(test_image):
            return {"message": "Debug image 'dummy.jpg' not found in backend folder."}
            
        print(f"[API] 🧪 Running Single-Image Debug on {test_image}...")
        
        try:
            results = run_segmentation(test_image, prompt, debug=True)
            
            if not results:
                 return {"message": f"AI found no '{prompt}' in the debug image."}
            
            return {
                "message": f"Found {len(results)} regions in debug image.",
                "command": {
                    "type": "segmentation",
                    "action": "display",
                    "params": { "polygons": results }
                }
            }
        except Exception as e:
            traceback.print_exc()
            return {"message": f"Segmentation Error: {str(e)}"}

    # --- DEFAULT: CHAT ---
    return {
        "message": f"AI: I received '{message}'. Try 'segment 3d door' or 'segment window'."
    }

if __name__ == "__main__":
    import uvicorn
    
    if SCENE_PATH:
        print(f"✅ Active Scene Path: {SCENE_PATH}")
    else:
        print("⚠️ WARNING: No Scene Path found! 3D Fusion will fail.")
        
    uvicorn.run(app, host="0.0.0.0", port=8000)