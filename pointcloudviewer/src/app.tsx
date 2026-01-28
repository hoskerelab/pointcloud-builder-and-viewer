// src/app.tsx

import { createRoot } from 'react-dom/client'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { FileTree } from "@/components/FileTree"
import { GLBViewer } from "@/components/GLBViewer"
import { ImageGallery } from "@/components/ImageGallery"
import { StreetViewer } from "@/components/StreetViewer"
import type { GLBViewerControls } from "@/src/contexts/ViewerContext"
import { useSceneData } from "@/hooks/useSceneData"
import type { SceneCamera, SceneImage } from "@/src/types/scene"
import { FolderOpen, Box, Map, Eye, Video } from 'lucide-react'
import { ViewerTools } from '@/components/ViewerTools'; // Viewer toolbar
import * as THREE from 'three'; // Import THREE for Euler
import { ChatInterface, ViewerCommand } from "@/components/ChatInterface"
import { RtspFloatingWidget } from "@/components/RtspFloatingWidget";
import { RtspPanel } from "@/components/RtspPanel";
import { ReportPage } from '@/components/ReportPage'
import type { CurrentMeasurement, Measurement } from "@/src/types/measurement";
import { toSafeFileUrl } from "@/lib/safeFile";
import { projectWorldPointToImage } from "@/hooks/useSceneData";

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
  const [showRtsp, setShowRtsp] = useState(false);
  const currentImage = useMemo(() => {
    if (!sceneData) return null;
    return sceneData.images.find((img) => img.index === highlightedImageIndex)
      ?? sceneData.images[0]
      ?? null;
  }, [sceneData, highlightedImageIndex]);
  const currentCamera = useMemo(() => {
    if (!sceneData || !currentImage) return null;
    return sceneData.cameras.find((camera) => camera.image?.index === currentImage.index || camera.index === currentImage.index)
      ?? null;
  }, [sceneData, currentImage]);

  // Refs for viewer controls
  const glbViewerRef = useRef<GLBViewerControls>(null);

  // --- STATE & CONTROLS ---
  const [toolMode, setToolMode] = useState<'navigate' | 'distance' | 'area' | 'segment'>('navigate');
  const [modelOrientation, setModelOrientation] = useState(new THREE.Euler(0, 0, 0));
  const [pointSize, setPointSize] = useState(1.0);
  const [measurementPoints, setMeasurementPoints] = useState<THREE.Vector3[]>([]);
  const [segmentationPolygons, setSegmentationPolygons] = useState<any[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

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

  useEffect(() => {
    let cancelled = false;

    const loadMeasurements = async () => {
      if (!selectedScene) {
        setMeasurements([]);
        return;
      }
      const saved = await window.electron?.loadMeasurements?.(selectedScene);
      if (!cancelled && Array.isArray(saved)) {
        setMeasurements(saved as Measurement[]);
      }
    };

    loadMeasurements();

    return () => {
      cancelled = true;
    };
  }, [selectedScene]);

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

  const handleMeasurementSelect = (measurement: Measurement) => {
    if (measurement.imagePath && sceneData) {
      const match = sceneData.images.find((img) => img.absolutePath === measurement.imagePath);
      if (match) {
        handleImageSelect(match);
      }
    }
    if (measurement.points && measurement.points.length > 0) {
      setMeasurementPoints(measurement.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      setRedoStack([]);
      setToolMode(measurement.kind === 'area' ? 'area' : 'distance');
    }
  };

  const handleMeasurementDelete = async (measurement: Measurement) => {
    if (!selectedScene) return;
    const next = measurements.filter((entry) => entry.id !== measurement.id);
    setMeasurements(next);
    await window.electron?.saveMeasurements?.(selectedScene, next);
    if (measurement.snapshotPath) {
      await window.electron?.deleteMeasurementSnapshot?.(selectedScene, measurement.id);
    }
  };

  const handleMeasurementRename = async (measurement: Measurement, name: string) => {
    if (!selectedScene) return;
    const next = measurements.map((entry) =>
      entry.id === measurement.id ? { ...entry, name } : entry
    );
    setMeasurements(next);
    await window.electron?.saveMeasurements?.(selectedScene, next);
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

  const currentMeasurement = useMemo<CurrentMeasurement | null>(() => {
    if (toolMode === 'distance' && measurementPoints.length >= 2) {
      const last = measurementPoints[measurementPoints.length - 1];
      const prev = measurementPoints[measurementPoints.length - 2];
      return {
        value: last.distanceTo(prev),
        unit: 'units',
        kind: 'distance',
      };
    }
    if (toolMode === 'area' && measurementPoints.length >= 3) {
      const v0 = measurementPoints[0];
      let area = 0;
      for (let i = 1; i < measurementPoints.length - 1; i += 1) {
        const v1 = measurementPoints[i];
        const v2 = measurementPoints[i + 1];
        const edge1 = new THREE.Vector3().subVectors(v1, v0);
        const edge2 = new THREE.Vector3().subVectors(v2, v0);
        area += new THREE.Vector3().crossVectors(edge1, edge2).length() * 0.5;
      }
      return {
        value: area,
        unit: 'units',
        kind: 'area',
      };
    }
    return null;
  }, [toolMode, measurementPoints]);

  const canSaveMeasurement = Boolean(selectedScene && currentMeasurement);

  const handleSaveMeasurement = async (name: string) => {
    if (!selectedScene || !currentMeasurement) return;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    let snapshotPath: string | undefined;
    let imagePath: string | undefined;
    if (currentImage?.absolutePath && currentCamera) {
      imagePath = currentImage.absolutePath;
      const dataUrl = await buildMeasurementSnapshot(
        currentImage.absolutePath,
        currentCamera.extrinsicsW2C ?? currentCamera.extrinsics,
        currentCamera.intrinsics,
        measurementPoints,
        currentMeasurement
      );
      if (dataUrl) {
        const savedPath = await window.electron?.saveMeasurementSnapshot?.(selectedScene, id, dataUrl);
        if (savedPath) snapshotPath = savedPath;
      }
    }

    const entry: Measurement = {
      id,
      name,
      value: currentMeasurement.value,
      unit: currentMeasurement.unit,
      kind: currentMeasurement.kind,
      createdAt: new Date().toISOString(),
      imagePath,
      snapshotPath,
      points: measurementPoints.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      })),
    };
    const next = [...measurements, entry];
    setMeasurements(next);
    await window.electron?.saveMeasurements?.(selectedScene, next);
  };

  const buildMeasurementSnapshot = async (
    absoluteImagePath: string,
    extrinsicsW2C: number[][],
    intrinsics: number[][],
    points: THREE.Vector3[],
    measurement: CurrentMeasurement
  ): Promise<string | null> => {
    try {
      const img = await loadImage(toSafeFileUrl(absoluteImagePath));
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, width, height);

      const projected = points
        .map((point) => {
          const coords = projectWorldPointToImage(
            extrinsicsW2C,
            intrinsics,
            [point.x, point.y, point.z]
          );
          if (!coords) return null;
          return { u: coords.u, v: coords.v };
        })
        .filter(Boolean) as Array<{ u: number; v: number }>;

      if (projected.length === 0) {
        return canvas.toDataURL('image/png');
      }

      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';

      if (measurement.kind === 'area' && projected.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(projected[0].u, projected[0].v);
        for (let i = 1; i < projected.length; i += 1) {
          ctx.lineTo(projected[i].u, projected[i].v);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(projected[0].u, projected[0].v);
        for (let i = 1; i < projected.length; i += 1) {
          ctx.lineTo(projected[i].u, projected[i].v);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      projected.forEach((p, index) => {
        ctx.beginPath();
        ctx.arc(p.u, p.v, 6, 0, Math.PI * 2);
        ctx.fill();

        const label = String.fromCharCode(65 + index);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(p.u - 8, p.v - 24, 16, 14);
        ctx.fillStyle = 'white';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.u, p.v - 17);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      });

      const labelText = `${measurement.value.toFixed(3)} ${measurement.unit}`;
      let labelPosition = projected[projected.length - 1];
      if (measurement.kind === 'area' && projected.length >= 3) {
        const centroid = projected.reduce(
          (acc, p) => ({ u: acc.u + p.u / projected.length, v: acc.v + p.v / projected.length }),
          { u: 0, v: 0 }
        );
        labelPosition = centroid;
      } else if (projected.length >= 2) {
        const last = projected[projected.length - 1];
        const prev = projected[projected.length - 2];
        labelPosition = { u: (last.u + prev.u) / 2, v: (last.v + prev.v) / 2 };
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(labelPosition.u - 40, labelPosition.v - 18, 80, 16);
      ctx.fillStyle = 'white';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, labelPosition.u, labelPosition.v - 10);

      return canvas.toDataURL('image/png');
    } catch (error) {
      console.warn('Unable to build measurement snapshot:', error);
      return null;
    }
  };

  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (event) => reject(event);
      img.src = src;
    });

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
              <Button
                onClick={() => setShowRtsp((prev) => !prev)}
                variant="ghost"
                size="icon"
                className="size-sidebar-icon hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-pressed={showRtsp}
              >
                <Video className="size-sidebar-icon" />
                <span className="sr-only">Toggle Live Stream</span>
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

            {/* RIGHT PANEL: Chat only (stream is now floating)
            <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
              <div className="h-full border-l border-border bg-sidebar">
                <ChatInterface onCommand={handleViewerCommand} />
              </div>
            </ResizablePanel> */}
            {/* RIGHT PANEL: Split into two sections */}
            <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
              <ResizablePanelGroup direction="vertical" className="h-full">

                {/* TOP HALF: existing chat */}
                <ResizablePanel defaultSize={40} minSize={20}>
                  <div className="h-full border-l border-border bg-sidebar">
                    <ChatInterface onCommand={handleViewerCommand} />
                  </div>
                </ResizablePanel>

                <ResizableHandle />

                {/* BOTTOM HALF: Report page */}
                <ResizablePanel defaultSize={60} minSize={20}>
                  <div className="h-full border-l border-b border-border bg-sidebar">
                    <div className="h-full">
                      <ReportPage
                        measurements={measurements}
                        currentMeasurement={currentMeasurement}
                        canSave={canSaveMeasurement}
                        onSaveMeasurement={handleSaveMeasurement}
                        hasScene={Boolean(selectedScene)}
                        onSelectMeasurement={handleMeasurementSelect}
                        onDeleteMeasurement={handleMeasurementDelete}
                        onRenameMeasurement={handleMeasurementRename}
                      />
                    </div>
                  </div>
                </ResizablePanel>

              </ResizablePanelGroup>
            </ResizablePanel>


          </ResizablePanelGroup>
        </main>
        {showRtsp && <RtspFloatingWidget />}
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

