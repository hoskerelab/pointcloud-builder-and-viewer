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
  const [uploadedPlyPaths, setUploadedPlyPaths] = useState<string[]>([]); // Temp file paths for received PLYs
  const [isUploading, setIsUploading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [useDepthMaps, setUseDepthMaps] = useState(false);

  // Live capture previews (from Python bridge)
  const [captureMode, setCaptureMode] = useState<'idle' | 'gopro' | 'gopro_helios'>('idle');
  const [captureState, setCaptureState] = useState<'idle' | 'preview' | 'recording'>('idle');
  const [rgbPreview, setRgbPreview] = useState<string | null>(null);
  const [depthPreview, setDepthPreview] = useState<string | null>(null);

  // Refs for viewer controls
  const glbViewerRef = useRef<GLBViewerControls>(null);
  const sceneGraphViewerRef = useRef<SceneGraphViewerControls>(null);
  const submapsWsRef = useRef<WebSocket | null>(null);

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


  // Subscribe to preview frames from live capture bridge
  useEffect(() => {
    if (!window.electron.onCaptureFrame) return;

    window.electron.onCaptureFrame((msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'rgb' && msg.jpeg_b64) {
        setRgbPreview(`data:image/jpeg;base64,${msg.jpeg_b64}`);
      } else if (msg.type === 'rgbd') {
        if (msg.rgb_jpeg_b64) {
          setRgbPreview(`data:image/jpeg;base64,${msg.rgb_jpeg_b64}`);
        }
        if (msg.depth_jpeg_b64) {
          setDepthPreview(`data:image/jpeg;base64,${msg.depth_jpeg_b64}`);
        }
      }
    });
  }, []);

  // Subscribe to submap point clouds from backend broadcast websocket
  useEffect(() => {
    const backendUrl = 'ws://localhost:8000';
    try {
      const ws = new WebSocket(`${backendUrl}/ws/submaps`);
      ws.binaryType = 'blob';
      submapsWsRef.current = ws;

      ws.onopen = () => {
        console.log('Submaps WebSocket connection opened');
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          const plyBlob = event.data;
          try {
            const buffer = await plyBlob.arrayBuffer();
            const tempPath = await window.electron.saveTempPLY(buffer);
            if (!tempPath) {
              console.error('Failed to save temp PLY file from /ws/submaps');
              return;
            }
            const fileUrl = `file://${tempPath}`;
            setUploadedPlyPaths(prev => [...prev, tempPath]);
            setUploadedGlbs(prev => [...prev, fileUrl]);
            setGlbOnlyPath(fileUrl);
            setViewMode('glb-only');
            console.log('Received PLY file from /ws/submaps, saved to', tempPath);
          } catch (err) {
            console.error('Error handling received PLY file from /ws/submaps:', err);
          }
        } else if (typeof event.data === 'string') {
          if (event.data.startsWith('filename:')) {
            const filename = event.data.split(':')[1];
            console.log('Received submap filename:', filename);
          } else if (event.data.startsWith('status:')) {
            console.log('Submap status:', event.data);
          } else {
            console.log('Submaps WS message:', event.data);
          }
        }
      };

      ws.onclose = (ev) => {
        console.log('Submaps WebSocket closed, code=', ev.code, 'reason=', ev.reason, 'wasClean=', ev.wasClean);
        if (submapsWsRef.current === ws) {
          submapsWsRef.current = null;
        }
      };

      ws.onerror = (event) => {
        console.error('Submaps WebSocket encountered an error event:', event);
      };
    } catch (err) {
      console.error('Failed to open Submaps WebSocket:', err);
    }

    return () => {
      if (submapsWsRef.current && submapsWsRef.current.readyState === WebSocket.OPEN) {
        submapsWsRef.current.close();
      }
      submapsWsRef.current = null;
    };
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

  const handleStartRecording = () => {
    // Deprecated: live capture is handled by Python bridge now.
    alert('Use GoPro / GoPro + Helios2 buttons for live capture.');
  };

  const handleStopRecording = () => {
    // Deprecated: live capture stop is handled via stopLiveCapture.
    alert('Use Stop Capture in the live capture section.');
  };

  const handleUploadImages = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // Allow both RGB images and optional depth .npy files
    input.accept = 'image/*,.npy';
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

        // If requested, inform the backend that this session will include
        // paired raw depth maps that need projection onto RGB.
        if (useDepthMaps) {
          try {
            ws.send('config:use_raw_depth:1');
          } catch (err) {
            console.error('Failed to send depth config:', err);
          }
        }

        if (!useDepthMaps) {
          // Original behavior: send all images sequentially.
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
              if (!file.type.startsWith('image/')) continue;
              const buffer = await file.arrayBuffer();
              ws.send(buffer);
              imagesSent++;
              console.log(`Sent image ${imagesSent}/${totalImages}`);
              await new Promise(resolve => setTimeout(resolve, 400));
            } catch (error) {
              console.error(`Error sending image ${i}:`, error);
            }
          }
        } else {
          // Depth-enabled mode: pair RGB images with matching .npy depth maps
          type Pair = { rgb?: File; depth?: File };
          const pairs: Record<string, Pair> = {};

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const name = file.name.toLowerCase();
            const match = name.match(/\d+/);
            if (!match) continue;
            const key = match[0];

            if (!pairs[key]) pairs[key] = {};

            if (file.type.startsWith('image/')) {
              pairs[key].rgb = file;
            } else if (name.endsWith('.npy')) {
              pairs[key].depth = file;
            }
          }

          const keys = Object.keys(pairs).sort((a, b) => Number(a) - Number(b));

          for (const key of keys) {
            const pair = pairs[key];
            if (!pair.rgb) {
              console.warn(`Skipping frame ${key}: missing RGB image`);
              continue;
            }
            try {
              const rgbBuffer = await pair.rgb.arrayBuffer();
              ws.send(rgbBuffer);
              imagesSent++;
              console.log(`Sent RGB for frame ${key} (${imagesSent}/${totalImages})`);

              if (pair.depth) {
                const depthBuffer = await pair.depth.arrayBuffer();
                ws.send(depthBuffer);
                console.log(`Sent depth for frame ${key}`);
              } else {
                console.warn(`No depth map for frame ${key}`);
              }

              await new Promise(resolve => setTimeout(resolve, 400));
            } catch (error) {
              console.error(`Error sending data for frame ${key}:`, error);
            }
          }
        }

        // Inform server that we are done sending so it can flush any remaining batches
        try {
          ws.send('done');
          console.log('Sent done');
        } catch (error) {
          console.error('Error sending done:', error);
        }
        // Don't close here - let the server close after processing
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          // For uploads, point clouds are now delivered via /ws/submaps.
          console.log('Received binary data on upload WebSocket (ignored; using /ws/submaps)');
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

  const handleDownloadAllSubmaps = async () => {
    if (uploadedPlyPaths.length === 0) {
      return;
    }
    try {
      const outDir = await window.electron.exportSubmaps?.(uploadedPlyPaths);
      if (outDir) {
        console.log('Exported submaps to', outDir);
      }
    } catch (error) {
      console.error('Failed to export submaps:', error);
    }
  };

  const handleSaveMergedPointCloud = async () => {
    try {
      const response = await fetch('http://localhost:8000/export_merged_ply');
      if (!response.ok) {
        console.error('Failed to fetch merged PLY:', response.status, response.statusText);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged_pointcloud.ply';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download merged PLY:', error);
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
              <SidebarGroupLabel>Live Capture</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="flex gap-2 mb-2">
                  <Button
                    onClick={() => {
                      setCaptureMode('gopro');
                    }}
                    variant={captureMode === 'gopro' ? 'default' : 'ghost'}
                    className="flex-1"
                  >
                    GoPro (RGB)
                  </Button>
                  <Button
                    onClick={() => {
                      setCaptureMode('gopro_helios');
                    }}
                    variant={captureMode === 'gopro_helios' ? 'default' : 'ghost'}
                    className="flex-1"
                  >
                    GoPro + Helios2
                  </Button>
                </div>
                <div className="flex gap-2 mb-2">
                  <Button
                    onClick={async () => {
                      if (captureMode === 'idle') return;
                      await window.electron.stopLiveCapture?.();
                      await window.electron.startLiveCapture?.(captureMode as 'gopro' | 'gopro_helios', true);
                      setCaptureState('preview');
                    }}
                    variant={captureState === 'preview' ? 'default' : 'ghost'}
                    className="flex-1"
                    disabled={captureMode === 'idle'}
                  >
                    Start Stream
                  </Button>
                  <Button
                    onClick={async () => {
                      if (captureMode === 'idle') return;
                      await window.electron.stopLiveCapture?.();
                      await window.electron.startLiveCapture?.(captureMode as 'gopro' | 'gopro_helios', false);
                      setCaptureState('recording');
                    }}
                    variant={captureState === 'recording' ? 'default' : 'ghost'}
                    className="flex-1"
                    disabled={captureMode === 'idle'}
                  >
                    Start Recording
                  </Button>
                </div>
                {rgbPreview && (
                  <img
                    src={rgbPreview}
                    className="w-full h-40 object-contain bg-black rounded mb-2"
                  />
                )}
                {captureMode === 'gopro_helios' && depthPreview && (
                  <img
                    src={depthPreview}
                    className="w-full h-40 object-contain bg-black rounded mb-2"
                  />
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    onClick={async () => {
                      await window.electron.stopLiveCapture?.();
                      setCaptureState('idle');
                    }}
                    variant="ghost"
                    className="flex-1"
                  >
                    Stop Capture
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="use-depth-maps"
                    type="checkbox"
                    checked={useDepthMaps}
                    onChange={e => setUseDepthMaps(e.target.checked)}
                  />
                  <label htmlFor="use-depth-maps" className="text-sm">
                    Use depth maps (folder upload)
                  </label>
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
                <div className="relative h-full w-full">
                  <div className="absolute top-2 left-2 z-10 flex gap-2 bg-background/80 backdrop-blur-sm border border-border rounded-md p-1 shadow-md">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={uploadedPlyPaths.length === 0}
                      onClick={handleDownloadAllSubmaps}
                      className="text-xs"
                    >
                      Save submaps
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={uploadedGlbs.length === 0}
                      onClick={handleSaveMergedPointCloud}
                      className="text-xs"
                    >
                      Save merged
                    </Button>
                  </div>
                  <GLBViewer ref={glbViewerRef} filePath={glbOnlyPath} uploadedGlbs={uploadedGlbs} />
                </div>
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