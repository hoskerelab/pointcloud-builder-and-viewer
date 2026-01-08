import { createRoot } from 'react-dom/client'
import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { FileTree } from "@/components/FileTree"
import { PDFViewer } from "@/components/PDFViewer"
import { GLBViewer } from "@/components/GLBViewer"
import { QAPairsViewer } from "@/components/QAPairsViewer"
import { ImageGallery } from "@/components/ImageGallery"
import { SceneGraphViewer } from "@/components/SceneGraphViewer"
import { ChatInterface, type ViewerCommand } from "@/components/ChatInterface"
import { ViewerProvider } from "@/src/contexts/ViewerContext"
import type { GLBViewerControls, SceneGraphViewerControls } from "@/src/contexts/ViewerContext"
import { FolderOpen, Box } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [glbPath, setGlbPath] = useState<string | null>(null);
  const [qaPairsPath, setQaPairsPath] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'sceneGraph' | '3dModel'>('3dModel');
  const [viewMode, setViewMode] = useState<'scene' | 'glb-only'>('glb-only');
  const [glbOnlyPath, setGlbOnlyPath] = useState<string | null>(null);
  const [uploadedGlbs, setUploadedGlbs] = useState<string[]>([]); // List of uploaded GLB URLs
  const [isUploading, setIsUploading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Refs for viewer controls
  const glbViewerRef = useRef<GLBViewerControls>(null);
  const sceneGraphViewerRef = useRef<SceneGraphViewerControls>(null);

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Update PDF path when scene changes
  useEffect(() => {
    const updatePDFPath = async () => {
      if (!selectedScene) {
        setPdfPath(null);
        return;
      }

      const path = await window.electron.getScenePDFPath(selectedScene);
      setPdfPath(path);
    };

    updatePDFPath();
  }, [selectedScene]);

  // Update GLB path when scene changes
  useEffect(() => {
    const updateGLBPath = async () => {
      if (!selectedScene) {
        setGlbPath(null);
        return;
      }

      const path = await window.electron.getSceneGLBPath(selectedScene);
      setGlbPath(path);
    };

    updateGLBPath();
  }, [selectedScene]);

  // Update QA pairs path when scene changes
  useEffect(() => {
    const updateQAPairsPath = async () => {
      if (!selectedScene) {
        setQaPairsPath(null);
        return;
      }

      const path = await window.electron.getSceneQAPairsPath(selectedScene);
      setQaPairsPath(path);
    };

    updateQAPairsPath();
  }, [selectedScene]);

  // Auto-open Downloads folder on mount
  useEffect(() => {
    const openDownloads = async () => {
      const downloadsPath = await window.electron.getDownloadsPath?.();
      if (downloadsPath) {
        setRootPath(downloadsPath);
      }
    };
    openDownloads();
  }, []);

  // Enumerate camera devices on mount
  useEffect(() => {
    const getCameraDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameraDevices(videoDevices);
      } catch (error) {
        console.error('Error enumerating devices:', error);
      }
    };
    getCameraDevices();
  }, []);

  const handleOpenFolder = async () => {
    const path = await window.electron.openDirectory();
    if (path) {
      setRootPath(path);
      setSelectedFile(null);
      setSelectedScene(null);
      setViewMode('scene');
      setGlbOnlyPath(null);
    }
  };

  const handleOpenGLBFile = async () => {
    const path = await window.electron.openGLBFile();
    if (path) {
      setGlbOnlyPath(path);
      setViewMode('glb-only');
    }
  };

  const handleOpenPCDFile = async () => {
    const path = await window.electron.openPCDFile();
    if (path) {
      setGlbOnlyPath(path);
      setViewMode('glb-only');
    }
  };

  const handleOpenPLYFile = async () => {
    const path = await window.electron.openPLYFile();
    if (path) {
      setGlbOnlyPath(path);
      setViewMode('glb-only');
    }
  };

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    console.log('Selected file:', path);
  };

  const handleSceneSelect = (path: string) => {
    setSelectedScene(path);
    console.log('Selected scene:', path);
  };

  const handleCameraChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value;
    if (deviceId) {
      // Stop previous stream
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
      setSelectedCamera(deviceId);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        setCameraStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Error accessing camera.');
      }
    }
  };

  const handleStartRecording = () => {
    if (!cameraStream || !videoRef.current) {
      alert('No camera selected.');
      return;
    }
    setIsRecording(true);
    const backendUrl = 'ws://localhost:8000'; // WebSocket URL
    const ws = new WebSocket(`${backendUrl}/ws/upload`);

    ws.onopen = () => {
      console.log('WebSocket opened for recording');
      wsRef.current = ws;
      recordingIntervalRef.current = setInterval(() => {
        if (videoRef.current && ws.readyState === WebSocket.OPEN) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            ctx.drawImage(videoRef.current, 0, 0);
            canvas.toBlob((blob) => {
              if (blob) {
                ws.send(blob);
                console.log('Sent frame');
              }
            }, 'image/png');
          }
        }
      }, 300); // 2 images per second = 500ms interval
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Received PLY file data
        const plyUrl = URL.createObjectURL(event.data);
        setUploadedGlbs(prev => [...prev, plyUrl]);
        setGlbOnlyPath(plyUrl); // Automatically set to display the new PLY
        setViewMode('glb-only'); // Switch to glb-only mode
        console.log('Received PLY file');
      } else if (typeof event.data === 'string') {
        // Server sends textual messages in the form of prefix:value
        if (event.data.startsWith('filename:')) {
          const filename = event.data.split(':')[1];
          console.log('Received filename:', filename);
        } else if (event.data.startsWith('error:')) {
          // Detailed server-side error message. Store it so UI can display.
          const detail = event.data.slice('error:'.length);
          setServerError(detail);
          console.error('Server error:', detail);
        } else if (event.data === 'ping') {
          // Respond to keepalive ping
          try { ws.send('pong'); } catch (e) { /* ignore */ }
        } else if (event.data.startsWith('status:')) {
          // Processing status update
          console.log('Processing status:', event.data);
        } else {
          // Unrecognized text message
          console.log('WS message:', event.data);
        }
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed for recording');
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  };

  const handleStopRecording = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send("done");
      console.log('Sent done');
    }
    setIsRecording(false);
  };

  const handleUploadImages = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      setIsUploading(true);
      const backendUrl = 'ws://localhost:8000'; // WebSocket URL

      const ws = new WebSocket(`${backendUrl}/ws/upload`);
      
      // Configure WebSocket for longer timeouts
      // Note: These are not standard WebSocket options, but some browsers support them
      // ws.binaryType = 'arraybuffer';

      let imagesSent = 0;
      const totalImages = files.length;

      ws.onopen = async () => {
        console.log('WebSocket connection opened');
        // Send all images over WebSocket sequentially with small delays
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const buffer = await file.arrayBuffer();
            ws.send(buffer);
            imagesSent++;
            console.log(`Sent image ${imagesSent}/${totalImages}`);
            // Small delay between sends to prevent overwhelming the backend
            await new Promise(resolve => setTimeout(resolve, 400));
          } catch (error) {
            console.error(`Error sending image ${i}:`, error);
          }
        }
        // Inform server that we are done sending images so it can flush any remaining partial batch
        try {
          ws.send("done");
          console.log('Sent done');
        } catch (error) {
          console.error('Error sending done:', error);
        }
        // Don't close here - let the server close after processing
      };

      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
          // Received PLY file data
          const plyUrl = URL.createObjectURL(event.data);
          setUploadedGlbs(prev => [...prev, plyUrl]);
          setGlbOnlyPath(plyUrl); // Automatically set to display the new PLY
          setViewMode('glb-only'); // Switch to glb-only mode
          console.log('Received PLY file');
        } else if (typeof event.data === 'string') {
          // Server sends textual messages in the form of prefix:value
          if (event.data.startsWith('filename:')) {
            const filename = event.data.split(':')[1];
            console.log('Received filename:', filename);
          } else if (event.data.startsWith('error:')) {
            // Detailed server-side error message. Store it so UI can display.
            const detail = event.data.slice('error:'.length);
            setServerError(detail);
            console.error('Server error:', detail);
          } else if (event.data === 'ping') {
            // Respond to keepalive ping
            try { ws.send('pong'); } catch (e) { /* ignore */ }
          } else if (event.data.startsWith('status:')) {
            // Processing status update
            console.log('Processing status:', event.data);
          } else {
            // Unrecognized text message
            console.log('WS message:', event.data);
          }
        }
      };

      ws.onclose = (ev) => {
        console.log('WebSocket closed, code=', ev.code, 'reason=', ev.reason, 'wasClean=', ev.wasClean);
        // If there was no serverError captured, try to surface close reason
        if (!serverError && ev.reason) {
          setServerError(`Closed: code=${ev.code} reason=${ev.reason}`);
        }
        setIsUploading(false);
      };

      ws.onerror = (event) => {
        // The browser's onerror provides limited info; log the event and
        // attempt to surface any server-sent error message previously received.
        console.error('WebSocket encountered an error event:', event);
        if (!serverError) {
          setServerError('WebSocket error — see console for details');
        }
        setIsUploading(false);
      };
    };
    input.click();
  };

  const handleViewerCommand = (command: ViewerCommand) => {
    console.log('Executing viewer command:', command);

    switch (command.type) {
      case 'glb':
        if (glbViewerRef.current) {
          switch (command.action) {
            case 'resetCamera':
              glbViewerRef.current.resetCamera();
              break;
            case 'setCameraPosition':
              if (command.params?.x !== undefined && command.params?.y !== undefined && command.params?.z !== undefined) {
                glbViewerRef.current.setCameraPosition(
                  command.params.x as number,
                  command.params.y as number,
                  command.params.z as number
                );
              }
              break;
            case 'focusOnPoint':
              if (command.params?.x !== undefined && command.params?.y !== undefined && command.params?.z !== undefined) {
                glbViewerRef.current.focusOnPoint(
                  command.params.x as number,
                  command.params.y as number,
                  command.params.z as number
                );
              }
              break;
          }
        }
        break;

      case 'sceneGraph':
        if (sceneGraphViewerRef.current) {
          switch (command.action) {
            case 'selectNode':
              if (command.params?.nodeId) {
                sceneGraphViewerRef.current.selectNode(command.params.nodeId as string);
              }
              break;
            case 'clearSelection':
              sceneGraphViewerRef.current.clearSelection();
              break;
            case 'highlightNodes':
              if (command.params?.nodeIds && Array.isArray(command.params.nodeIds)) {
                sceneGraphViewerRef.current.highlightNodes(command.params.nodeIds as string[]);
              }
              break;
            case 'zoomToNode':
              if (command.params?.nodeId) {
                sceneGraphViewerRef.current.zoomToNode(command.params.nodeId as string);
              }
              break;
            case 'resetView':
              sceneGraphViewerRef.current.resetView();
              break;
          }
        }
        break;

      case 'camera':
        // Handle view switching
        if (command.action === 'switch3D') {
          setActiveView('3dModel');
        } else if (command.action === 'switchGraph') {
          setActiveView('sceneGraph');
        }
        break;
    }
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="dark bg-background text-foreground h-screen w-full flex overflow-hidden">
        <Sidebar
          collapsible="none"
          sideColumnButtons={
            <>
              {/* <Button onClick={handleOpenFolder} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <FolderOpen className="size-sidebar-icon" />
                <span className="sr-only">Open Folder</span>
              </Button> */}
              <div className="flex flex-col items-center gap-1">
                <Button onClick={handleOpenGLBFile} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <Box className="size-sidebar-icon" />
                  <span className="sr-only">Open GLB File</span>
                </Button>
                <span className="text-xs text-sidebar-foreground/70">GLB</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Button onClick={handleOpenPCDFile} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <Box className="size-sidebar-icon" />
                  <span className="sr-only">Open PCD File</span>
                </Button>
                <span className="text-xs text-sidebar-foreground/70">PCD</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Button onClick={handleOpenPLYFile} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <Box className="size-sidebar-icon" />
                  <span className="sr-only">Open PLY File</span>
                </Button>
                <span className="text-xs text-sidebar-foreground/70">PLY</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Button onClick={handleUploadImages} disabled={isUploading} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <FolderOpen className="size-sidebar-icon" />
                  <span className="sr-only">Upload Images</span>
                </Button>
                <span className="text-xs text-sidebar-foreground/70">Upload</span>
              </div>
            </>
          }
        >
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Camera</SidebarGroupLabel>
              <SidebarGroupContent>
                <select onChange={handleCameraChange} className="w-full p-2 border rounded text-black bg-white">
                  <option value="">Select Camera</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
                <div className="mt-2">
                  <video ref={videoRef} className="w-full h-48 bg-black rounded" autoPlay muted />
                </div>
                <div className="mt-2 flex gap-2">
                  <Button onClick={handleStartRecording} disabled={isRecording} variant="ghost" className="flex-1">
                    Start Recording
                  </Button>
                  <Button onClick={handleStopRecording} disabled={!isRecording} variant="ghost" className="flex-1">
                    Stop Recording
                  </Button>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        {/* Main Viewer Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1">
            {viewMode === 'glb-only' ? (
              // GLB-only mode: Full-screen 3D viewer
              glbOnlyPath ? (
                <GLBViewer ref={glbViewerRef} filePath={glbOnlyPath} uploadedGlbs={uploadedGlbs} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-muted-foreground">Please select a GLB file</span>
                </div>
              )
            ) : !selectedScene ? (
              <div className="flex h-full items-center justify-center">
                <span className="text-muted-foreground">Please select a scene</span>
              </div>
            ) : (
              <ResizablePanelGroup direction="vertical" className="h-full rounded-lg">
                {/* Top Row: 2 Columns */}
                <ResizablePanel defaultSize={50}>
                  <ResizablePanelGroup direction="horizontal">
                    {/* Left Panel: Chat Interface */}
                    <ResizablePanel defaultSize={33}>
                      <ChatInterface onCommand={handleViewerCommand} />
                    </ResizablePanel>
                    <ResizableHandle />
                    {/* Right Panel: Combined View with Switcher */}
                    <ResizablePanel defaultSize={67}>
                      <div className="relative h-full w-full">
                        {/* Toggle Button Group - Top Left */}
                        <div className="absolute top-2 left-2 z-10 flex gap-1 bg-background/95 backdrop-blur-sm border border-border rounded-md p-1 shadow-lg">
                          <Button
                            size="sm"
                            variant={activeView === '3dModel' ? 'default' : 'ghost'}
                            onClick={() => {
                              setActiveView('3dModel');
                              // Focus the 3D viewer after state updates
                              setTimeout(() => glbViewerRef.current?.focus(), 0);
                            }}
                            className="text-xs"
                          >
                            3D Model
                          </Button>
                          <Button
                            size="sm"
                            variant={activeView === 'sceneGraph' ? 'default' : 'ghost'}
                            onClick={() => {
                              setActiveView('sceneGraph');
                              // Focus the scene graph viewer after state updates
                              setTimeout(() => sceneGraphViewerRef.current?.focus(), 0);
                            }}
                            className="text-xs"
                          >
                            Scene Graph
                          </Button>
                        </div>

                        {/* Conditional View Rendering - Keep both mounted to preserve state */}
                        <div className={activeView === 'sceneGraph' ? 'block h-full w-full' : 'hidden'}>
                          <SceneGraphViewer ref={sceneGraphViewerRef} scenePath={selectedScene} isVisible={activeView === 'sceneGraph'} />
                        </div>
                        <div className={activeView === '3dModel' ? 'block h-full w-full' : 'hidden'}>
                          <GLBViewer ref={glbViewerRef} filePath={glbPath} uploadedGlbs={uploadedGlbs} />
                        </div>
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>
                <ResizableHandle />
                {/* Bottom Row: 3 Columns */}
                <ResizablePanel defaultSize={50}>
                  <ResizablePanelGroup direction="horizontal">
                    <ResizablePanel defaultSize={50}>
                      <PDFViewer pdfPath={pdfPath} />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={25}>
                      <QAPairsViewer qaPairsPath={qaPairsPath} />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={25}>
                      <ImageGallery scenePath={selectedScene} />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

const root = createRoot(document.body);
root.render(<App />);