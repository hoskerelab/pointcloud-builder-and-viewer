// src/app.tsx

import { createRoot } from 'react-dom/client'
import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { FileTree } from "@/components/FileTree"
import { GLBViewer } from "@/components/GLBViewer"
import { ImageGallery } from "@/components/ImageGallery"
import { StreetViewer } from "@/components/StreetViewer"
import type { GLBViewerControls } from "@/src/contexts/ViewerContext"
import { useSceneData } from "@/hooks/useSceneData"
import type { SceneCamera, SceneImage } from "@/src/types/scene"
import { FolderOpen, Box, Map, Eye } from 'lucide-react'
import { ViewerTools } from '@/components/ViewerTools'; // Viewer toolbar
import * as THREE from 'three'; // Import THREE for Euler
import { ChatInterface, ViewerCommand } from "@/components/ChatInterface"
import { RtspPanel } from "@/components/RtspPanel";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [glbPath, setGlbPath] = useState<string | null>(null);
  const [sceneViewMode, setSceneViewMode] = useState<'scene' | 'glb-only'>('scene');
  const [mainView, setMainView] = useState<'3d' | 'street'>('3d');
  const [glbOnlyPath, setGlbOnlyPath] = useState<string | null>(null);
  const scenePathForData = sceneViewMode === 'scene' ? selectedScene : null;
  const { data: sceneData, loading: sceneDataLoading, error: sceneDataError } = useSceneData(scenePathForData);
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number | null>(null);
  const [highlightedImageIndex, setHighlightedImageIndex] = useState<number | null>(null);

  // Refs for viewer controls
  const glbViewerRef = useRef<GLBViewerControls>(null);

  // --- STATE & CONTROLS ---
  const [toolMode, setToolMode] = useState<'navigate' | 'distance' | 'area' | 'segment'>('navigate');
  const [modelOrientation, setModelOrientation] = useState(new THREE.Euler(0, 0, 0));
  const [pointSize, setPointSize] = useState(1.0);
  const [measurementPoints, setMeasurementPoints] = useState<THREE.Vector3[]>([]);
  const [segmentationPolygons, setSegmentationPolygons] = useState<any[]>([]);

  // Undo/Redo
  const [redoStack, setRedoStack] = useState<THREE.Vector3[]>([]); // Stack for redo
   // --- END ---

  const handleViewerCommand = (command: ViewerCommand) => {
    console.log("Received Viewer Command:", command);

    switch (command.type) {
      // Handle Standard GLB Controls
      case 'glb':
        if (command.action === 'resetCamera') {
            glbViewerRef.current?.resetCamera();
        }
        if (command.action === 'setCameraPosition' && command.params) {
            const { x, y, z } = command.params as { x: number; y: number; z: number };
            glbViewerRef.current?.setCameraPosition(x, y, z);
        }
        break;

      // Handle Segmentation Data from Backend
      case 'segmentation': // This matches the type we send from Python
        if (command.action === 'display' && command.params?.polygons) {
            console.log("Applying segmentation polygons:", command.params.polygons);
            setSegmentationPolygons(command.params.polygons as any[]);
            setMainView('3d'); // Force switch to 3D to see the result
        }
        break;

      // Handle View Switching
      case 'camera':
        if (command.action === 'switch3D') setMainView('3d');
        if (command.action === 'switchStreet') setMainView('street');
        break;
    }
  };

  useEffect(() => {
    setSelectedCameraIndex(null);
    setHighlightedImageIndex(null);
    setMainView('3d');
  }, [scenePathForData]);

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Update GLB path when scene changes
  useEffect(() => {
    const updateGLBPath = async () => {
      if (!selectedScene) {
        setGlbPath(null);
        return;
      }

      const path = await window.electron?.getSceneGLBPath?.(selectedScene);
      setGlbPath(path ?? null);
    };

    updateGLBPath();
  }, [selectedScene]);

  // Auto-open Downloads folder on mount
  useEffect(() => {
    const openDownloads = async () => {
      const downloadsPath = await window.electron?.getDownloadsPath?.();
      if (downloadsPath) {
        setRootPath(downloadsPath);
      }
    };
    openDownloads();
  }, []);

  const handleOpenFolder = async () => {
    const path = await window.electron?.openDirectory?.();
    if (path) {
      setRootPath(path);
      setSelectedScene(null);
      setSceneViewMode('scene');
      setGlbOnlyPath(null);
      setMainView('3d');
    }
  };

  const handleOpenGLBFile = async () => {
    const path = await window.electron?.openGLBFile?.();
    if (path) {
      setGlbOnlyPath(path);
      setSceneViewMode('glb-only');
      setMainView('3d');
    }
  };

  const handleSceneSelect = (path: string) => {
    setSelectedScene(path);
    console.log('Selected scene:', path);
  };

  const handleCameraSelect = (camera: SceneCamera | null) => {
    if (!camera) {
      setSelectedCameraIndex(null);
      setHighlightedImageIndex(null);
      glbViewerRef.current?.resetCamera();
      return;
    }

    setSelectedCameraIndex(camera.index);
    glbViewerRef.current?.animateToCameraView(camera, 0.8);

    if (camera.image?.index !== undefined) {
      setHighlightedImageIndex(camera.image.index);
    }
  };

  const handleImageSelect = (image: SceneImage) => {
    setHighlightedImageIndex(image.index);
    const matchingCamera = sceneData?.cameras.find((camera) => camera.image?.index === image.index);
    if (matchingCamera) {
      setSelectedCameraIndex(matchingCamera.index);
    }
    setMainView('street');
  };

  const handlePointFound = (point: THREE.Vector3) => {
    setRedoStack([]); // New action clears redo history
    setMeasurementPoints((prev) => {
      // DISTANCE MODE: Only keep 2 points max
      if (toolMode === 'distance') {
        if (prev.length >= 2) return [point];
        return [...prev, point];
      }
      
      // AREA MODE: Keep adding points
      if (toolMode === 'area') {
        return [...prev, point];
      }
      
      return prev;
    });
  };

  // Undo (Pop last point, push to redo)
  const handleUndo = () => {
      setMeasurementPoints(prev => {
          if (prev.length === 0) return prev;
          const newPoints = [...prev];
          const popped = newPoints.pop();
          if (popped) setRedoStack(stack => [...stack, popped]);
          return newPoints;
      });
      // Remove the corresponding ray
      glbViewerRef.current?.undoLastRay?.();
  };

  // Redo (Pop from redo, push to points)
  const handleRedo = () => {
      setRedoStack(stack => {
          if (stack.length === 0) return stack;
          const newStack = [...stack];
          const pointToRestore = newStack.pop();
          
          if (pointToRestore) {
              setMeasurementPoints(prev => [...prev, pointToRestore]);
          }
          return newStack;
      });
      glbViewerRef.current?.redoDebugRay();
  };

  // Clear Measurements ONLY
  const handleClearMeasurements = () => {
      setMeasurementPoints([]);
      setRedoStack([]);
  };

  // Full Reset (Camera + Measurements)
  const handleResetViewer = () => {
    glbViewerRef.current?.resetCamera();
    setModelOrientation(new THREE.Euler(0, 0, 0));
    setToolMode('navigate');
    setPointSize(1.0); // Reset point size on reset
    handleClearMeasurements(); // Clear measurements on reset
    setSegmentationPolygons([]); // Clear segmentation on reset
  };

  // --- NEW HANDLER ---
  // This is called by StreetViewer when the user clicks the 2D image
  const handle2DRaycast = (ray: THREE.Ray) => {
    // Allow both distance and area modes to find 3D points
    if (toolMode !== 'distance' && toolMode !== 'area') return;

    // Tell GLBViewer to do the hard work
    glbViewerRef.current?.find3DPointFromRay(ray);
  };
  // --- END ---

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="dark bg-background text-foreground h-screen w-full flex overflow-hidden">
        <Sidebar
          collapsible="none"
          sideColumnButtons={
            <>
              <Button onClick={handleOpenFolder} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <FolderOpen className="size-sidebar-icon" />
                <span className="sr-only">Open Folder</span>
              </Button>
              <Button onClick={handleOpenGLBFile} variant="ghost" size="icon" className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <Box className="size-sidebar-icon" />
                <span className="sr-only">Open GLB File</span>
              </Button>
            </>
          }
        >
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Scenes</SidebarGroupLabel>
              <SidebarGroupContent>
                <FileTree
                  rootPath={rootPath}
                  selectedScene={selectedScene}
                  onSceneSelect={handleSceneSelect}
                />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        {/* Main Viewer Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* 3. HORIZONTAL SPLIT: Viewer (Left) | Chat (Right) */}
          <ResizablePanelGroup direction="horizontal">
            
            {/* LEFT PANEL: The 3D/Street Viewer + Image Gallery */}
            <ResizablePanel defaultSize={75}>
              <div className="flex-1 h-full">
                {sceneViewMode === 'glb-only' ? (
                  glbOnlyPath ? (
                    <div className="relative h-full w-full"> 
                      <ViewerTools
                        toolMode={toolMode}
                        onSetToolMode={setToolMode}
                        onSetOrientation={setModelOrientation}
                        onReset={handleResetViewer}
                        pointSize={pointSize}
                        onSetPointSize={setPointSize}
                        // NEW PROPS
                        canUndo={measurementPoints.length > 0}
                        canRedo={redoStack.length > 0}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        onClearMeasurements={handleClearMeasurements}
                      />
                      <GLBViewer 
                        ref={glbViewerRef} 
                        glbPath={glbOnlyPath}
                        toolMode={toolMode} 
                        modelOrientation={modelOrientation} 
                        pointSize={pointSize}
                        measurementPoints={measurementPoints}
                        onPointFound={handlePointFound}
                        onClearMeasurements={handleClearMeasurements}
                        // Pass segmentation polygons here if generic GLB needs it
                        segmentationPolygons={segmentationPolygons}
                      />
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
                  // VERTICAL SPLIT: Viewer (Top) | Gallery (Bottom)
                  <ResizablePanelGroup direction="vertical" className="h-full rounded-lg">
                    <ResizablePanel defaultSize={70} minSize={40}>
                      <div className="relative h-full w-full">
                        <ViewerTools
                          toolMode={toolMode}
                          onSetToolMode={setToolMode}
                          onSetOrientation={setModelOrientation}
                          onReset={handleResetViewer}
                          pointSize={pointSize}
                          onSetPointSize={setPointSize}
                          canUndo={measurementPoints.length > 0}
                          canRedo={redoStack.length > 0}
                          onUndo={handleUndo}
                          onRedo={handleRedo}
                          onClearMeasurements={handleClearMeasurements}
                        />

                        {/* 3D View */}
                        <div style={{ display: mainView === '3d' ? 'block' : 'none', width: '100%', height: '100%' }}>
                          <GLBViewer
                            ref={glbViewerRef}
                            glbPath={glbPath}
                            cameras={sceneData?.cameras}
                            selectedCameraIndex={selectedCameraIndex}
                            onCameraSelect={handleCameraSelect}
                            toolMode={toolMode}
                            modelOrientation={modelOrientation}
                            pointSize={pointSize}
                            measurementPoints={measurementPoints}
                            onPointFound={handlePointFound}
                            onClearMeasurements={handleClearMeasurements}
                            // Important: Pass the segmentation state down!
                            segmentationPolygons={segmentationPolygons}
                          />
                        </div>

                        {/* Street View */}
                        <div style={{ display: mainView === 'street' ? 'block' : 'none', width: '100%', height: '100%' }}>
                          <StreetViewer
                            sceneData={sceneData ?? null}
                            currentImage={sceneData?.images.find((img) => img.index === highlightedImageIndex) ?? sceneData?.images[0] ?? null}
                            onImageSelect={handleImageSelect}
                            toolMode={toolMode}
                            measurementPoints={measurementPoints}
                            onRaycast={handle2DRaycast}
                          />
                        </div>

                        <Button
                          variant="outline"
                          size="icon"
                          className="absolute top-4 right-4 z-10 bg-background/80 backdrop-blur-sm"
                          onClick={() => setMainView(mainView === '3d' ? 'street' : '3d')}
                        >
                          {mainView === '3d' ? <Eye className="h-4 w-4" /> : <Map className="h-4 w-4" />}
                        </Button>
                      </div>
                    </ResizablePanel>
                    
                    <ResizableHandle />
                    
                    <ResizablePanel defaultSize={30} minSize={20}>
                      <ImageGallery
                        scenePath={selectedScene}
                        imagesData={sceneData?.images}
                        highlightedImageIndex={highlightedImageIndex}
                        onImageSelect={handleImageSelect}
                      />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* RIGHT PANEL: Split into two sections */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
            <ResizablePanelGroup direction="vertical" className="h-full">
              
              {/* TOP HALF: your new window/view */}
              <ResizablePanel defaultSize={50} minSize={20}>
                <div className="h-full border-l border-b border-border bg-sidebar">
                  {/* Put your new component here */}
                  <div className="p-3 text-sm text-muted-foreground">
                    <RtspPanel />
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle />

              {/* BOTTOM HALF: existing chat */}
              <ResizablePanel defaultSize={50} minSize={20}>
                <div className="h-full border-l border-border bg-sidebar">
                  <ChatInterface onCommand={handleViewerCommand} />
                </div>
              </ResizablePanel>

            </ResizablePanelGroup>
          </ResizablePanel>


          </ResizablePanelGroup>
        </main>
      </div>
    </SidebarProvider>
  );
}

const root = createRoot(document.body);
root.render(<App />);


/* This might be important:
{/* Main Viewer Area *}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1">
            {sceneViewMode === 'glb-only' ? (
              // GLB-only mode: Full-screen 3D viewer
              glbOnlyPath ? (
                <div className="relative h-full w-full"> 
                  {/* <-- Add relative container *}
                  <ViewerTools
                    toolMode={toolMode}
                    onSetToolMode={setToolMode}
                    onSetOrientation={setModelOrientation}
                    onReset={handleResetViewer}
                    pointSize={pointSize}
                    onSetPointSize={setPointSize}
                  />

                  <GLBViewer 
                    ref={glbViewerRef} 
                    glbPath={glbOnlyPath}
                    toolMode={toolMode} 
                    modelOrientation={modelOrientation} 
                    pointSize={pointSize}
                    measurementPoints={measurementPoints} // <-- Pass state down
                    onPointFound={handlePointFound} // <-- Pass handler down
                    onClearMeasurements={handleClearMeasurements} // <-- Add this
                  />
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
              // Scene mode: Resizable panels with 3D viewer and image gallery
              <ResizablePanelGroup direction="vertical" className="h-full rounded-lg">
                <ResizablePanel defaultSize={70} minSize={40}>
                  <div className="relative h-full w-full">
                    {/* --- ADD TOOL PANEL --- *}

                    {/* Render tools as long as a scene is selected *}
                    <ViewerTools
                      toolMode={toolMode}
                      onSetToolMode={setToolMode}
                      onSetOrientation={setModelOrientation}
                      onReset={handleResetViewer}
                      pointSize={pointSize}
                      onSetPointSize={setPointSize}
                    />

                    {/* GLBViewer (always rendered, hidden with CSS) *}
                    <div
                      style={{
                        display: mainView === '3d' ? 'block' : 'none',
                        width: '100%',
                        height: '100%',
                      }}
                    >
                      <GLBViewer
                        ref={glbViewerRef}
                        glbPath={glbPath}
                        cameras={sceneData?.cameras}
                        selectedCameraIndex={selectedCameraIndex}
                        onCameraSelect={handleCameraSelect}
                        toolMode={toolMode}
                        modelOrientation={modelOrientation}
                        pointSize={pointSize}
                        measurementPoints={measurementPoints}
                        onPointFound={handlePointFound}
                        onClearMeasurements={handleClearMeasurements}
                      />
                    </div>

                    {/* StreetViewer (always rendered, hidden with CSS) *}
                    <div
                      style={{
                        display: mainView === 'street' ? 'block' : 'none',
                        width: '100%',
                        height: '100%',
                      }}
                    >
                      <StreetViewer
                        sceneData={sceneData ?? null}
                        currentImage={
                          sceneData?.images.find(
                            (img) => img.index === highlightedImageIndex,
                          ) ??
                          sceneData?.images[0] ??
                          null
                        }
                        onImageSelect={handleImageSelect}
                        toolMode={toolMode}
                        measurementPoints={measurementPoints}
                        onRaycast={handle2DRaycast}
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="icon"
                      className="absolute top-4 right-4 z-10 bg-background/80 backdrop-blur-sm"
                      onClick={() => setMainView(mainView === '3d' ? 'street' : '3d')}
                      title={mainView === '3d' ? 'Switch to Street View' : 'Switch to 3D View'}
                    >
                      {mainView === '3d' ? <Eye className="h-4 w-4" /> : <Map className="h-4 w-4" />}
                    </Button>
                    {sceneDataLoading && (
                      <div className="pointer-events-none absolute bottom-4 right-4 rounded-md bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                        Loading camera metadata…
                      </div>
                    )}
                    {sceneDataError && (
                      <div className="pointer-events-none absolute bottom-4 right-4 rounded-md bg-destructive/80 px-3 py-1 text-xs text-destructive-foreground shadow-sm">
                        {sceneDataError}
                      </div>
                    )}
                  </div>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={30} minSize={20}>
                  <ImageGallery
                    scenePath={selectedScene}
                    imagesData={sceneData?.images}
                    highlightedImageIndex={highlightedImageIndex}
                    onImageSelect={handleImageSelect}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </main>
*/