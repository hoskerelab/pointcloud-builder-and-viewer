# Chat UI Integration Guide

## Overview

The placeholder panel has been replaced with a fully functional **Chat UI** that can communicate with a FastAPI backend and control both the 3D model viewer and scene graph viewer.

## Architecture

### Components Created

1. **[ChatInterface.tsx](components/ChatInterface.tsx)** - Main chat UI component
   - Modern message bubbles (user/assistant/system)
   - Text input with send button
   - Auto-scrolling message history
   - Loading states and error handling
   - Command execution via `onCommand` callback

2. **[ViewerContext.tsx](src/contexts/ViewerContext.tsx)** - Shared state for viewer controls
   - Provides refs to GLBViewer and SceneGraphViewer
   - Defines control interfaces for both viewers

3. **Updated Viewers**
   - [GLBViewer.tsx](components/GLBViewer.tsx) - Now exposes camera control methods via ref
   - [SceneGraphViewer.tsx](components/SceneGraphViewer.tsx) - Now exposes graph control methods via ref

### IPC Communication

#### Backend Communication
The chat uses Electron IPC to send messages to a FastAPI backend:

**Handler:** `chat:sendMessage` ([src/index.ts:352-375](src/index.ts#L352-L375))
- Sends POST request to `http://localhost:8000/chat`
- Request body: `{ message: string }`
- Response format:
  ```typescript
  {
    message?: string;       // Assistant response text
    content?: string;       // Alternative response field
    error?: string;         // Error message if failed
    command?: {            // Optional viewer command
      type: 'glb' | 'sceneGraph' | 'camera';
      action: string;
      params?: Record<string, unknown>;
    };
  }
  ```

#### Exposed API
- `window.electron.sendChatMessage(message: string, endpoint?: string)`
  - Default endpoint: `http://localhost:8000`
  - Returns Promise<ChatResponse>

## Viewer Control API

### GLBViewer Controls

```typescript
interface GLBViewerControls {
  setCameraPosition(x: number, y: number, z: number): void;
  setCameraTarget(x: number, y: number, z: number): void;
  resetCamera(): void;
  focusOnPoint(x: number, y: number, z: number): void;
}
```

**Example Commands:**
```json
{
  "type": "glb",
  "action": "resetCamera"
}

{
  "type": "glb",
  "action": "setCameraPosition",
  "params": { "x": 1, "y": 2, "z": 3 }
}

{
  "type": "glb",
  "action": "focusOnPoint",
  "params": { "x": 0.5, "y": 0.5, "z": 0.5 }
}
```

### SceneGraphViewer Controls

```typescript
interface SceneGraphViewerControls {
  selectNode(nodeId: string): void;
  clearSelection(): void;
  highlightNodes(nodeIds: string[]): void;
  zoomToNode(nodeId: string): void;
  resetView(): void;
}
```

**Example Commands:**
```json
{
  "type": "sceneGraph",
  "action": "selectNode",
  "params": { "nodeId": "image_hash.png" }
}

{
  "type": "sceneGraph",
  "action": "highlightNodes",
  "params": { "nodeIds": ["hash1.png", "hash2.png"] }
}

{
  "type": "sceneGraph",
  "action": "zoomToNode",
  "params": { "nodeId": "image_hash.png" }
}

{
  "type": "sceneGraph",
  "action": "resetView"
}
```

### Camera/View Controls

```json
{
  "type": "camera",
  "action": "switch3D"
}

{
  "type": "camera",
  "action": "switchGraph"
}
```

## FastAPI Backend Example

Here's a minimal FastAPI backend example to get started:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# Enable CORS for Electron
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    message: str

class ChatResponse(BaseModel):
    message: str
    command: dict | None = None

@app.post("/chat")
async def chat(msg: ChatMessage) -> ChatResponse:
    user_message = msg.message.lower()

    # Example: Reset camera command
    if "reset camera" in user_message:
        return ChatResponse(
            message="Camera has been reset to default position.",
            command={
                "type": "glb",
                "action": "resetCamera"
            }
        )

    # Example: Select node command
    if "show node" in user_message or "select" in user_message:
        # Parse node ID from message (simplified example)
        return ChatResponse(
            message="Selecting the requested node in the scene graph.",
            command={
                "type": "sceneGraph",
                "action": "zoomToNode",
                "params": {"nodeId": "extracted_node_id.png"}
            }
        )

    # Default response
    return ChatResponse(
        message="I'm a bridge inspection assistant. Ask me about the inspection data or to control the viewers!"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## Running the Backend

1. Install FastAPI:
   ```bash
   pip install fastapi uvicorn
   ```

2. Save the example above as `backend.py`

3. Run the server:
   ```bash
   python backend.py
   ```

4. Enable the backend in the chat interface:
   - Open [ChatInterface.tsx](components/ChatInterface.tsx)
   - Change line 40: `const [backendEnabled, setBackendEnabled] = useState(true);`
   - Or add a toggle button in the UI to enable/disable the backend connection

5. The Electron app will connect to `http://localhost:8000/chat` automatically

## Message Types

### User Message
```typescript
{
  id: string;
  role: 'user';
  content: string;
  timestamp: Date;
}
```

### Assistant Message
```typescript
{
  id: string;
  role: 'assistant';
  content: string;
  timestamp: Date;
  error?: string;  // Present if there was an error
}
```

### System Message
```typescript
{
  id: string;
  role: 'system';
  content: string;
  timestamp: Date;
}
```

## UI Features

- **Backend status indicator**: Shows connection status in header and footer
- **Disabled by default**: Send button is disabled until backend is connected (set `backendEnabled` state to true to enable)
- **Welcome message**: Initial AI assistant greeting explaining backend setup status
- **Enter to send**: Press Enter to send message, Shift+Enter for new line (when enabled)
- **Auto-scroll**: Messages automatically scroll to bottom
- **Loading indicator**: Animated spinner while waiting for response
- **Error handling**: Red error badges for failed requests
- **Avatar badges**: Visual distinction between user (U) and assistant (AI) messages
- **Resizable panel**: Chat panel can be resized horizontally

## Integration in App.tsx

The chat is integrated in [src/app.tsx](src/app.tsx):

```typescript
// Handler for viewer commands from chat
const handleViewerCommand = (command: ViewerCommand) => {
  switch (command.type) {
    case 'glb':
      // Control 3D viewer
      glbViewerRef.current?.resetCamera();
      break;
    case 'sceneGraph':
      // Control scene graph
      sceneGraphViewerRef.current?.selectNode(nodeId);
      break;
    case 'camera':
      // Switch active view
      setActiveView('3dModel' | 'sceneGraph');
      break;
  }
};

// In JSX
<ChatInterface onCommand={handleViewerCommand} />
<GLBViewer ref={glbViewerRef} glbPath={glbPath} />
<SceneGraphViewer ref={sceneGraphViewerRef} scenePath={selectedScene} />
```

## Future Enhancements

Potential improvements for the chat system:

1. **Streaming Responses** - Add support for SSE/WebSocket streaming
2. **Message History** - Persist chat history to local storage
3. **File Upload** - Allow uploading images for analysis
4. **Voice Input** - Add speech-to-text for voice commands
5. **Custom Endpoint** - UI to configure backend endpoint URL
6. **Authentication** - Add API key support for secured backends
7. **Rich Responses** - Support markdown, code blocks, images in responses
8. **Multi-turn Context** - Send conversation history to backend

## Troubleshooting

### Backend Connection Failed
- Check that FastAPI server is running on `http://localhost:8000`
- Verify CORS is enabled in the FastAPI app
- Check browser console for network errors

### Commands Not Executing
- Ensure `command` object is included in backend response
- Verify command structure matches expected format
- Check browser console for command execution logs

### Type Errors
- TypeScript definitions are in [src/types/renderer.d.ts](src/types/renderer.d.ts)
- ChatResponse interface must match backend response format
