// components/StreetViewer.tsx

import React, { useMemo, useState, useRef, useLayoutEffect, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { SceneImage, SceneData, SceneCamera } from '@/src/types/scene';
// Correct import from the root 'hooks' directory
import { useNavGraph } from '@/hooks/useNavGraph'; 
import { Loader2 } from 'lucide-react'; 
import { toSafeFileUrl } from '@/lib/safeFile';

import * as THREE from 'three';
import { useThree } from '@react-three/fiber'; // We'll borrow this for its raycaster

const NAV_DEBUG = false; // Set to true to enable navigation debug logs

// Use .set() to ensure Row-Major order (n11, n12, n13, n14...)
function matrixFrom3x4(e: number[][]): THREE.Matrix4 {
  const mat = new THREE.Matrix4();
  mat.set(
    e[0][0], e[0][1], e[0][2], e[0][3],
    e[1][0], e[1][1], e[1][2], e[1][3],
    e[2][0], e[2][1], e[2][2], e[2][3],
    0,       0,       0,       1
  );
  return mat;
}

interface StreetViewerProps {
  sceneData: SceneData | null;
  currentImage: SceneImage | null;
  onImageSelect: (image: SceneImage) => void;
  toolMode: 'navigate' | 'distance' | 'area';
  measurementPoints: THREE.Vector3[];
  onRaycast: (ray: THREE.Ray) => void; // <-- Updated prop
}

// Draw the markers on the 2D image
function StreetViewerOverlay({
  points,
  camera,
  imageSize: naturalSize, // natural image size (intrinsics domain)
  displaySize,            // actual rendered size on screen
  toolMode,
}: {
  points: THREE.Vector3[];
  camera: SceneCamera;
  imageSize: { width: number; height: number };
  displaySize: { width: number; height: number };
  toolMode: 'navigate' | 'distance' | 'area';
}) {
  // Helper for A, B, C labels
  const getLabel = (index: number) => String.fromCharCode(65 + index); 
  const { projectedPoints, area3D, labelData } = useMemo(() => {
    const K = camera.intrinsics;
    const W2C = matrixFrom3x4(camera.extrinsicsW2C);

    const fx = K[0][0];
    const fy = K[1][1];
    const cx = K[0][2];
    const cy = K[1][2];

    const scaleX = displaySize.width / naturalSize.width;
    const scaleY = displaySize.height / naturalSize.height;

    const project = (worldPoint: THREE.Vector3) => {
      // World -> Camera
      const camPoint = worldPoint.clone().applyMatrix4(W2C);

      // Behind camera
      if (camPoint.z <= 0) return null;

      // Project to natural coords
      const u_natural = fx * (camPoint.x / camPoint.z) + cx;
      const v_natural = fy * (camPoint.y / camPoint.z) + cy;

      // Scale to display coords
      const u = u_natural * scaleX;
      const v = v_natural * scaleY;

      // Bounds check (optional)
      if (u < 0 || u > displaySize.width || v < 0 || v > displaySize.height) {
        return null;
      }

      return { u, v };
    };

    // Project all measurement points
    const projectedPoints = points
      .map((p) => project(p))
      .filter(Boolean) as { u: number; v: number }[];

    // 1. Calculate Area (3D)
    let area3D = 0;
    if (points.length >= 3) {
        const v0 = points[0];
        for (let i = 1; i < points.length - 1; i++) {
            const v1 = points[i];
            const v2 = points[i + 1];
            const edge1 = new THREE.Vector3().subVectors(v1, v0);
            const edge2 = new THREE.Vector3().subVectors(v2, v0);
            area3D += new THREE.Vector3().crossVectors(edge1, edge2).length() * 0.5;
        }
    }

    // 2. Calculate Distance Label (last 2 points)
    let labelData: { u: number; v: number; distance: number } | null = null;
    if (points.length >= 2) {
        const p1 = points[points.length - 2];
        const p2 = points[points.length - 1];
        const distance = p1.distanceTo(p2);
        const mid3D = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const mid2D = project(mid3D);
        if (mid2D) {
            labelData = { ...mid2D, distance };
        }
    }

    return { projectedPoints, area3D, labelData };
  }, [points, camera, naturalSize, displaySize]);


  // Generate polygon string for SVG
  const polyPoints = projectedPoints.map(p => `${p.u},${p.v}`).join(' ');
  const isPolygon = projectedPoints.length >= 3; // Persistence Check

  // Calculate centroid for label placement
  const center = useMemo(() => {
      if (projectedPoints.length === 0) return null;
      let u = 0, v = 0;
      projectedPoints.forEach(p => { u += p.u; v += p.v; });
      return { u: u / projectedPoints.length, v: v / projectedPoints.length };
  }, [projectedPoints]);

   return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
        <svg className="absolute inset-0 w-full h-full">
            {isPolygon ? (
                <polygon 
                    points={polyPoints} 
                    fill="rgba(239, 68, 68, 0.3)" 
                    stroke="rgba(239, 68, 68, 0.8)" 
                    strokeWidth="2" 
                />
            ) : (
                projectedPoints.map((p, i) => {
                    if (i === 0) return null;
                    const prev = projectedPoints[i - 1];
                    return (
                        <line
                            key={`line-${i}`}
                            x1={prev.u} y1={prev.v}
                            x2={p.u} y2={p.v}
                            stroke="rgba(239, 68, 68, 0.8)"
                            strokeWidth="2"
                            strokeDasharray="4"
                        />
                    );
                })
            )}
        </svg>
      {/* Always Draw Vertices & Labels (A, B, C...) */}
      {projectedPoints.map((p, i) => (
        <div key={i} className="absolute w-4 h-4 border-2 border-red-500 bg-red-500/30 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.u}px`, top: `${p.v}px` }}>
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white bg-black/50 px-1 rounded">
            {getLabel(i)}
          </span>
        </div>
      ))}
      {/* Labels: Show Area if polygon, Distance if line */}
      {isPolygon && center && (
        <div className="absolute bg-black/80 text-xs text-white px-2 py-1 rounded pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: `${center.u}px`, top: `${center.v}px` }}>
          {area3D.toFixed(2)} units²
        </div>
      )}
      
      {!isPolygon && labelData && (
         <div className="absolute bg-black/80 text-xs text-white px-2 py-1 rounded pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: `${labelData.u}px`, top: `${labelData.v - 15}px` }}>
            {labelData.distance.toFixed(3)} units
         </div>
      )}
    </div>
  );
}

export function StreetViewer({ 
  sceneData, 
  currentImage, 
  onImageSelect,
  toolMode,
  measurementPoints,
  onRaycast // This won't be used directly, we'll call a new prop
 }: StreetViewerProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [imageReady, setImageReady] = useState(false);

  // 1. Call our new pre-computation hook
  const { navGraph, ready: navReady } = useNavGraph(sceneData);

  // Reset image states when currentImage changes
  useEffect(() => {
    setImageReady(false);
    setNaturalSize(null);
    setDisplaySize({ width: 0, height: 0 });
  }, [currentImage?.index]);
  
  // Track rendered size of the image (for scaling)
  useLayoutEffect(() => {
    const img = imageRef.current;
    if (!img) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0 && entries[0].contentRect) {
        const { width, height } = entries[0].contentRect;
        setDisplaySize({ width, height });
      }
    });

    resizeObserver.observe(img);

    return () => {
      resizeObserver.disconnect();
    };
  }, [currentImage, naturalSize]);

  // Start image click handler logic
  const currentCamera = useMemo(() => {
    if (!sceneData || !currentImage) return null;
    return sceneData.cameras.find(c => c.image?.index === currentImage.index || c.index === currentImage.index);
  }, [sceneData, currentImage]);

  const handleImageClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if ((toolMode !== 'distance' && toolMode !== 'area') || !currentCamera || !imageRef.current || !naturalSize) return;

    // 1. Get click coordinates relative to the image
    const rect = imageRef.current.getBoundingClientRect();
    const u = event.clientX - rect.left;
    const v = event.clientY - rect.top;

    console.log(`2D Click: (u: ${u}, v: ${v})`);

    // 3. Calculate Ray Direction in Camera Space (Unprojection)
    // We must account for the image being scaled (CSS) vs. its natural resolution (intrinsics)
    const { width: displayWidth, height: displayHeight } = rect;
    const { width: naturalWidth, height: naturalHeight } = naturalSize;
    
    // Convert click to natural image coordinates
    const u_natural = (u / displayWidth) * naturalWidth;
    const v_natural = (v / displayHeight) * naturalHeight;
    console.log(`Mapped to Natural Image Coords: (u_natural: ${u_natural}, v_natural: ${v_natural})`);

    // Get camera parameters
    const K = currentCamera.intrinsics;
    const fx = K[0][0];
    const fy = K[1][1];
    const cx = K[0][2];
    const cy = K[1][2];

    const x_cam = (u_natural - cx) / fx;
    const y_cam = (v_natural - cy) / fy;
    const z_cam = 1.0;

    const rayDir_cam = new THREE.Vector3(x_cam, y_cam, z_cam);

    // Transform Ray to World Space
    // A 3x4 matrix (number[3][4]) needs to be converted to a 16-element
    // array (4x4) by adding the [0, 0, 0, 1] row.
    const e = currentCamera.extrinsicsC2W;
    // const C2W_Matrix = new THREE.Matrix4().fromArray(C2W_Array);
    const C2W_Matrix = matrixFrom3x4(currentCamera.extrinsicsC2W);
    
    // Ray Origin is the camera position
    const rayOrigin_world = new THREE.Vector3().setFromMatrixPosition(C2W_Matrix);

    // Ray Direction
    const rayDir_world = rayDir_cam.transformDirection(C2W_Matrix).normalize();

    // Fire the event
    onRaycast(new THREE.Ray(rayOrigin_world, rayDir_world));
  };

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    requestAnimationFrame(() => {
      setImageReady(true);
    });
  };

  const handleNavigateToImage = (image: SceneImage) => {
    onImageSelect(image);
  };

  // 2. This logic is now CHEAP and FAST
  const navigationTargets = useMemo(() => {
    if (NAV_DEBUG) {
      console.log(`[StreetViewer] (RENDER) Updating 2D arrows.`);
    }

    if (!sceneData || !currentImage || !navGraph || !navReady || displaySize.width === 0) {
      return [];
    }

    const currentCamera = sceneData.cameras.find((camera) => {
      if (camera.image?.index === currentImage.index) return true;
      return camera.index === currentImage.index;
    });
    if (!currentCamera) return [];

    const pair = navGraph[currentCamera.index] ?? {};
    const { left, right } = pair;

    const getImageByCameraIndex = (idx: number | undefined): SceneImage | null => {
      if (idx == null) return null;
      const cam = sceneData.cameras.find((c) => c.index === idx);
      if (!cam) return null;
      if (cam.image) return cam.image;
      return sceneData.images.find((img) => img.index === cam.index) ?? null;
    };

    const targets: Array<{ side: 'left' | 'right'; left: number; top: number; image: SceneImage }> = [];

    const leftImage = getImageByCameraIndex(left);
    if (leftImage) {
      targets.push({
        side: 'left',
        left: displaySize.width * 0.15, // Fixed 15% position
        top: displaySize.height * 0.5, // Fixed 50% position
        image: leftImage,
      });
      if (NAV_DEBUG) {
        console.log(`[StreetViewer] (RENDER) Found left target: ${leftImage.index}`);
      }
    }

    const rightImage = getImageByCameraIndex(right);
    if (rightImage) {
      targets.push({
        side: 'right',
        left: displaySize.width * 0.85, // Fixed 85% position
        top: displaySize.height * 0.5, // Fixed 50% position
        image: rightImage,
      });
      if (NAV_DEBUG) {
        console.log(`[StreetViewer] (RENDER) Found right target: ${rightImage.index}`);
      }
    }

    return targets;
  }, [sceneData, currentImage, navGraph, navReady, displaySize]);

  if (!currentImage) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Select an image from the gallery below to start Street View</span>
      </div>
    );
  }

  // 3. Add a loading state
  if (!navReady && sceneData) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">
          Building navigation graph…
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center relative w-full h-full bg-background">
      <div className="relative max-w-full max-h-full">
        <img
          ref={imageRef}
          src={toSafeFileUrl(currentImage.absolutePath)}
          alt={currentImage.name}
          onLoad={handleImageLoad}
          onClick={handleImageClick} // <-- ADD CLICK HANDLER
          className={`max-w-full max-h-full object-contain block ${(toolMode === 'distance' || toolMode === 'area') ? 'cursor-crosshair' : ''}`} // <-- Add cursor
        />
        {imageReady && navigationTargets.length > 0 && (
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
            {navigationTargets.map((target) => (
              <Button
                key={`${currentImage.index}-${target.image.index}-${target.side}`}
                size="sm"
                variant="secondary"
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto bg-background/90"
                style={{ left: `${target.left}px`, top: `${target.top}px` }}
                onClick={() => handleNavigateToImage(target.image)}
                title={`Go ${target.side} → ${target.image.name}`}
              >
                {target.side === 'left' ? '←' : '→'}
              </Button>
            ))}
          </div>
        )}
        {/* --- ADD 2D OVERLAY --- */}
        {imageReady && currentCamera && naturalSize && (
          <StreetViewerOverlay
            points={measurementPoints}
            camera={currentCamera}
            imageSize={naturalSize} 
            displaySize={displaySize} // <--- Critical prop
            toolMode={toolMode}
          />
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-4 py-2">
        <p className="text-sm text-white/90 truncate text-center">
          {currentImage.name}
        </p>
      </div>
    </div>
  );
}
