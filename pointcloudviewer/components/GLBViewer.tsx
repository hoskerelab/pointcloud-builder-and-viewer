// components/GLBViewer.tsx

import React, {
  Suspense,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF, TrackballControls, Environment, ContactShadows, KeyboardControls, useKeyboardControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import type { GLBViewerControls } from '@/src/contexts/ViewerContext';
import type { SceneCamera } from '@/src/types/scene';
import { MeasurementOverlay } from './MeasurementOverlay';
import { SegmentationLayer } from './SegmentationLayer';
import { toSafeFileUrl } from '@/lib/safeFile';

interface GLBViewerProps {
  glbPath: string | null;
  cameras?: SceneCamera[];
  selectedCameraIndex?: number | null;
  onCameraSelect?: (camera: SceneCamera | null) => void;
  toolMode?: 'navigate' | 'distance' | 'area' | 'segment';
  modelOrientation?: THREE.Euler;
  pointSize?: number;
  measurementPoints: THREE.Vector3[];
  onPointFound: (point: THREE.Vector3) => void;
  onClearMeasurements: () => void;
  segmentationPolygons?: any[];
}

// --- NEW DEBUG COMPONENT ---
function DebugRay({ ray, index }: { ray: THREE.Ray; index: number }) {
  const lineRef = useRef<THREE.Line>(null);

  // Update geometry when ray changes
  useLayoutEffect(() => {
    if (lineRef.current) {
      const start = ray.origin;
      // Draw the ray 100 units long so we can see its path through the scene
      const end = new THREE.Vector3().copy(ray.direction).multiplyScalar(100).add(start);
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      lineRef.current.geometry.dispose(); // Clean up old geo
      lineRef.current.geometry = geometry;
    }
  }, [ray]);

  return (
    <group>
      {/* The Ray Line */}
      <line ref={lineRef}>
        <lineBasicMaterial 
          color="#00ff00" // Green
          opacity={index === 0 ? 0.8 : 0.3} // Latest ray is brighter
          transparent={true} 
          depthTest={false} // Draw on top of everything so we can see it even inside walls
        />
      </line>
      {/* A small sphere at the origin so we know where it started */}
      <mesh position={ray.origin}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color="#00ff00" wireframe />
      </mesh>
    </group>
  );
}
// --- END DEBUG COMPONENT ---

function Model({ 
  url, 
  onClick, 
  pointSize,
  sceneRef
}: { 
  url: string; 
  onClick?: (e: ThreeEvent<MouseEvent>) => void; // Click handler
  pointSize: number;
  sceneRef: React.MutableRefObject<THREE.Group | null>; 
}) {
  const { scene } = useGLTF(url);

  sceneRef.current = scene;
  
  // Update point size whenever pointSize prop changes
  useEffect(() => {
    scene.traverse((child) => {
      if ((child as THREE.Points).isPoints) {
        const points = child as THREE.Points;
        const material = points.material as THREE.PointsMaterial;
        
        // Update size and ensure attenuation is off so they stay visible
        material.size = pointSize;
        material.sizeAttenuation = false; 
        material.needsUpdate = true;
      }
    });
  }, [scene, pointSize]);
  
  return <primitive object={scene} onClick={onClick} />;
}

function SceneContextBridge({
  cameraRef,
  raycasterRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  raycasterRef: React.MutableRefObject<THREE.Raycaster | null>;
}): null {
  const { camera, raycaster } = useThree();
  cameraRef.current = camera;
  raycasterRef.current = raycaster;
  return null;
}

// ... (CameraController, CameraCapture, CameraAnimator remain unchanged) ...
function CameraController({ controlsRef, isFocused }: { controlsRef: React.RefObject<any>; isFocused: boolean; }): null {
  const { camera } = useThree();
  const [, get] = useKeyboardControls();
  const moveSpeed = 0.05;
  useFrame(() => {
    if (!isFocused) return;
    const { forward, backward, left, right, up, down } = get();
    if (!forward && !backward && !left && !right && !up && !down) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const direction = new THREE.Vector3();
    const right_vec = new THREE.Vector3();
    const movement = new THREE.Vector3();
    camera.getWorldDirection(direction);
    right_vec.crossVectors(camera.up, direction).normalize();
    if (forward) movement.addScaledVector(direction, moveSpeed);
    if (backward) movement.addScaledVector(direction, -moveSpeed);
    if (left) movement.addScaledVector(right_vec, moveSpeed);
    if (right) movement.addScaledVector(right_vec, -moveSpeed);
    if (up) movement.y += moveSpeed;
    if (down) movement.y -= moveSpeed;
    camera.position.add(movement);
    controls.target.add(movement);
    controls.update();
  });
  return null;
}

function CameraCapture({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }): null {
  const { camera } = useThree();
  cameraRef.current = camera;
  return null;
}

function CameraAnimator({ controlsRef, animationTargetRef }: { controlsRef: React.RefObject<any>; animationTargetRef: React.MutableRefObject<AnimationTarget | null>; }): null {
  const { camera } = useThree();
  useFrame(() => {
    const controls = controlsRef.current;
    const target = animationTargetRef.current;
    if (!controls || !target) return;
    const lerpAlpha = 0.12;
    camera.position.lerp(target.position, lerpAlpha);
    controls.target.lerp(target.target, lerpAlpha);
    camera.quaternion.slerp(target.quaternion, lerpAlpha);
    camera.up.lerp(target.up, lerpAlpha);
    controls.update();
    const positionClose = camera.position.distanceTo(target.position) < 1e-3;
    const targetClose = controls.target.distanceTo(target.target) < 1e-3;
    if (positionClose && targetClose) {
      camera.position.copy(target.position);
      controls.target.copy(target.target);
      camera.quaternion.copy(target.quaternion);
      camera.up.copy(target.up);
      controls.update();
      animationTargetRef.current = null;
    }
  });
  return null;
}

const CAMERA_SPHERE_RADIUS = 0.025;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 0.6;

interface AnimationTarget {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

function buildOrientationMatrix(rotationMatrix: number[][]): THREE.Matrix3 {
  const matrix = new THREE.Matrix3();
  if (!rotationMatrix || rotationMatrix.length < 3 || rotationMatrix[0]?.length < 3) {
    matrix.identity();
    return matrix;
  }
  const transpose = rotationMatrix[0].map((_, idx) => rotationMatrix.map(row => row[idx]));
  matrix.set(
    transpose[0][0], transpose[0][1], transpose[0][2],
    transpose[1][0], transpose[1][1], transpose[1][2],
    transpose[2][0], transpose[2][1], transpose[2][2],
  );
  return matrix;
}

function computeImageDimensions(intrinsics: number[][]): { width: number; height: number } {
  const cx = intrinsics?.[0]?.[2];
  const cy = intrinsics?.[1]?.[2];
  const width = Number.isFinite(cx) && (cx ?? 0) !== 0 ? (cx as number) * 2 : 1;
  const height = Number.isFinite(cy) && (cy ?? 0) !== 0 ? (cy as number) * 2 : 1;
  return { width, height };
}

function computeFrustum(camera: SceneCamera): Float32Array {
  const orientation = buildOrientationMatrix(camera.rotationMatrix);
  const { width, height } = computeImageDimensions(camera.intrinsics);
  const fx = camera.intrinsics[0][0] || 1;
  const fy = camera.intrinsics[1][1] || 1;
  const cx = camera.intrinsics[0][2] ?? width / 2;
  const cy = camera.intrinsics[1][2] ?? height / 2;
  const offsets = [{ u: 0, v: 0 }, { u: width, v: 0 }, { u: width, v: height }, { u: 0, v: height }];
  const position = new THREE.Vector3(...camera.position);
  const nearCorners = offsets.map(({ u, v }) => {
    const x = ((u - cx) / fx) * CAMERA_NEAR;
    const y = ((v - cy) / fy) * CAMERA_NEAR;
    const vector = new THREE.Vector3(x, y, CAMERA_NEAR);
    return vector.applyMatrix3(orientation).add(position.clone());
  });
  const farCorners = offsets.map(({ u, v }) => {
    const x = ((u - cx) / fx) * CAMERA_FAR;
    const y = ((v - cy) / fy) * CAMERA_FAR;
    const vector = new THREE.Vector3(x, y, CAMERA_FAR);
    return vector.applyMatrix3(orientation).add(position.clone());
  });
  const lines: number[] = [];
  const pushLine = (a: THREE.Vector3, b: THREE.Vector3) => {
    lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  nearCorners.forEach((corner) => pushLine(position, corner));
  for (let i = 0; i < nearCorners.length; i += 1) {
    const next = nearCorners[(i + 1) % nearCorners.length];
    pushLine(nearCorners[i], next);
  }
  for (let i = 0; i < farCorners.length; i += 1) {
    const next = farCorners[(i + 1) % farCorners.length];
    pushLine(farCorners[i], next);
  }
  for (let i = 0; i < nearCorners.length; i += 1) {
    pushLine(nearCorners[i], farCorners[i]);
  }
  return new Float32Array(lines);
}

function CameraGizmo({ camera, selected, onSelect }: { camera: SceneCamera; selected: boolean; onSelect?: (camera: SceneCamera | null) => void; }) {
  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(computeFrustum(camera), 3));
    return geometry;
  }, [camera]);
  useEffect(() => { return () => { lineGeometry.dispose(); }; }, [lineGeometry]);
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.(camera);
  }, [camera, onSelect]);
  const color = selected ? '#ffc53d' : '#3b82f6';
  return (
    <group>
      <mesh position={camera.position} onClick={handleClick}>
        <sphereGeometry args={[CAMERA_SPHERE_RADIUS, 16, 16]} />
        <meshStandardMaterial color={color} emissive={selected ? '#ffb700' : '#1d4ed8'} emissiveIntensity={selected ? 0.5 : 0.2} />
      </mesh>
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color={color} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

export const GLBViewer = forwardRef<GLBViewerControls, GLBViewerProps>(({ 
  glbPath, 
  cameras, 
  selectedCameraIndex, 
  onCameraSelect,
  toolMode = 'navigate', 
  modelOrientation = new THREE.Euler(0,0,0), 
  pointSize = 1.0, 
  measurementPoints, 
  onPointFound, 
  onClearMeasurements, 
  segmentationPolygons = [], // Default to empty
}, ref) => {
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const animationTargetRef = useRef<AnimationTarget | null>(null);

  const modelSceneRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);

  // --- ADD STATE FOR DEBUG RAYS ---
  const [debugRays, setDebugRays] = useState<THREE.Ray[]>([]);
  const [redoDebugRays, setRedoDebugRays] = useState<THREE.Ray[]>([]);

  const handleModelClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();

    // Even if we are navigating, we want to see where we clicked
    // if (event.ray) {
    //    setDebugRays(prev => [event.ray.clone(), ...prev].slice(0, 2));
    // }

    if (toolMode == 'navigate') {
      console.log('In Navigation mode, click ignored.');
      return; 
    }
    // Allow finite rays for Area mode until reset
    if (event.ray) {
       setDebugRays(prev => {
           const newRay = event.ray.clone();
           // If distance mode, keep max 2. If area mode, keep infinite (until reset).
           if (toolMode === 'distance') {
               return [newRay, ...prev].slice(0, 2);
           }
           return [newRay, ...prev];
       });
       // Clear redo stack on new action
       setRedoDebugRays([]);
    }

    if (raycasterRef.current) raycasterRef.current.params.Points.threshold = 0.05;

    console.log('--- Raycast Hit Event ---', event);
    console.log('Final Point Selected:', event.point); 
    
    onPointFound(event.point);
  }, [toolMode, onPointFound, raycasterRef]);

  // --- CLEAR DEBUG RAYS WHEN CLEARING MEASUREMENTS ---
  useEffect(() => {
    if (measurementPoints.length === 0) {
        setDebugRays([]);
        setRedoDebugRays([]);
    }
  }, [measurementPoints]);

  useEffect(() => {
    if (glbPath && containerRef.current) {
      containerRef.current.focus();
    }
  }, [glbPath]);

  useEffect(() => {
    let controls: any | null = null;
    let mounted = true;
    const handleStart = () => { animationTargetRef.current = null; };
    const attachListener = () => {
      if (!mounted) return;
      controls = controlsRef.current;
      if (controls) { controls.addEventListener('start', handleStart); } else { requestAnimationFrame(attachListener); }
    };
    attachListener();
    return () => { mounted = false; if (controls) { controls.removeEventListener('start', handleStart); } };
  }, [glbPath]);

  useImperativeHandle(ref, () => ({
    setCameraPosition: (x: number, y: number, z: number) => {
      if (cameraRef.current) { cameraRef.current.position.set(x, y, z); controlsRef.current?.update(); }
    },
    setCameraTarget: (x: number, y: number, z: number) => {
      if (controlsRef.current) { controlsRef.current.target.set(x, y, z); controlsRef.current.update(); }
    },
    resetCamera: () => {
      if (cameraRef.current && controlsRef.current) {
        cameraRef.current.position.set(0.75, 0.75, 1);
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
        animationTargetRef.current = null;
      }
    },
    focusOnPoint: (x: number, y: number, z: number) => {
      if (cameraRef.current && controlsRef.current) {
        const offset = new THREE.Vector3(0.5, 0.5, 0.5);
        cameraRef.current.position.set(x + offset.x, y + offset.y, z + offset.z);
        controlsRef.current.target.set(x, y, z);
        controlsRef.current.update();
        animationTargetRef.current = null;
      }
    },
    focus: () => { containerRef.current?.focus(); },
    animateToCameraView: (sceneCamera: SceneCamera, distance = 0.75) => {
      if (!cameraRef.current || !controlsRef.current) return;
      const orientation = buildOrientationMatrix(sceneCamera.rotationMatrix);
      const forward = new THREE.Vector3(0, 0, 1).applyMatrix3(orientation).normalize();
      if (forward.lengthSq() === 0) forward.set(0, 0, 1);
      const up = new THREE.Vector3(0, -1, 0).applyMatrix3(orientation).normalize();
      if (up.lengthSq() === 0) up.set(0, 1, 0);
      const cameraPosition = new THREE.Vector3(sceneCamera.position[0], sceneCamera.position[1], sceneCamera.position[2]);
      const viewerPosition = cameraPosition.clone().addScaledVector(forward, -distance);
      const lookTarget = cameraPosition.clone().addScaledVector(forward, 1.5);
      const orientationMatrix4 = new THREE.Matrix4().setFromMatrix3(orientation);
      const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(orientationMatrix4);
      cameraRef.current.up.copy(up);
      animationTargetRef.current = { position: viewerPosition, target: lookTarget, up: up.clone(), quaternion: targetQuaternion };
      containerRef.current?.focus();
    },
    
    find3DPointFromRay: (ray: THREE.Ray) => {
      const raycaster = raycasterRef.current;
      if (!modelSceneRef.current || !raycaster) return;
      
      // Clear Redo stack on new action
      setRedoDebugRays([]);
      // --- STORE RAY FOR DEBUGGING ---
      // Clone ray so not a mutable reference and allow multiple to be store in area mode
      setDebugRays(prev => {
          const newRay = ray.clone();
          if (toolMode === 'distance') return [newRay, ...prev].slice(0, 2);
          return [newRay, ...prev];
      });

      raycaster.set(ray.origin, ray.direction);
      raycaster.params.Points.threshold = 0.05; 

      console.log('Casting 2D Ray:', { 
        origin: ray.origin, 
        direction: ray.direction,
        threshold: raycaster.params.Points.threshold
      });

      const intersects = raycaster.intersectObject(modelSceneRef.current, true);

      if (intersects.length > 0) {
        const hit = intersects[0];
        console.log('--- 2D Raycast Hit ---', {
          point: hit.point,
          distance: hit.distance,
          distanceToRay: hit.distanceToRay 
        });
        onPointFound(hit.point);
      } else {
        console.log('--- 2D Raycast Miss ---');
      }
    },
    undoDebugRay: () => {
        setDebugRays(prev => {
            if (prev.length === 0) return prev;
            const [popped, ...rest] = prev;
            setRedoDebugRays(r => [popped, ...r]);
            return rest;
        });
    },
    redoDebugRay: () => {
        setRedoDebugRays(prev => {
            if (prev.length === 0) return prev;
            const [popped, ...rest] = prev;
            setDebugRays(r => [popped, ...r]);
            return rest;
        });
    },
  }));

  const fileUrl = useMemo(() => {
    if (!glbPath) return null;
    return toSafeFileUrl(glbPath);
  }, [glbPath]);

  const keyboardMap = useMemo(() => [
      { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
      { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
      { name: 'left', keys: ['KeyA', 'ArrowLeft'] },
      { name: 'right', keys: ['KeyD', 'ArrowRight'] },
      { name: 'up', keys: ['Space'] },
      { name: 'down', keys: ['ShiftLeft', 'ShiftRight'] },
    ], []);

  if (!fileUrl) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-sm text-muted-foreground">No scene selected</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-background outline-none focus:ring-2 focus:ring-muted-foreground/30 focus:ring-inset"
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onClick={() => containerRef.current?.focus()}
    >
      <KeyboardControls map={keyboardMap}>
        <Canvas
          camera={{ position: [0.75, 0.75, 1], fov: 50 }}
          shadows
          onPointerMissed={(event) => {
            if (event.type === 'pointerdown') {
              onCameraSelect?.(null);
              onClearMeasurements();
            }
          }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

          <Suspense fallback={<mesh><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="gray" wireframe /></mesh>}>
            <group rotation={modelOrientation}>
              <Model url={fileUrl} onClick={handleModelClick} pointSize={pointSize} sceneRef={modelSceneRef} />
            </group>
            <ContactShadows position={[0, -0.8, 0]} opacity={0.25} scale={10} blur={1.5} far={0.8} />
            <Environment preset="city" />
          </Suspense>

          {/* --- RENDER DEBUG RAYS --- */}
          {debugRays.map((ray, i) => (
            <DebugRay key={i} ray={ray} index={i} />
          ))}

          <MeasurementOverlay points={measurementPoints} />
          {/* Add the Segmentation Layer */}
          <SegmentationLayer polygons={segmentationPolygons} />

          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport axisColors={["#ff6b6b", "#6bff6b", "#6b6bff"]} labelColor="#f5f5f5" />
          </GizmoHelper>

          {cameras?.map((camera) => (
            <CameraGizmo
              key={camera.index}
              camera={camera}
              selected={selectedCameraIndex === camera.index}
              onSelect={onCameraSelect}
            />
          ))}

          <SceneContextBridge cameraRef={cameraRef} raycasterRef={raycasterRef} />
          <CameraCapture cameraRef={cameraRef} />
          <CameraAnimator controlsRef={controlsRef} animationTargetRef={animationTargetRef} />
          <CameraController controlsRef={controlsRef} isFocused={isFocused} />
          <TrackballControls
            ref={controlsRef}
            enabled={toolMode === 'navigate'}
            noPan={false}
            noZoom={false}
            noRotate={false}
            zoomSpeed={2.0}
            rotateSpeed={1.2}
            staticMoving={true}
            makeDefault
          />
        </Canvas>
      </KeyboardControls>
    </div>
  );
});
