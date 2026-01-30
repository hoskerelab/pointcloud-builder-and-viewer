import React, { Suspense, useMemo, useRef, useImperativeHandle, forwardRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { useGLTF, TrackballControls, Environment, ContactShadows, KeyboardControls, useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { GLBViewerControls } from '@/src/contexts/ViewerContext';

interface GLBViewerProps {
  filePath: string | null;
  uploadedGlbs?: string[];
}

function Model({ url }: { url: string }) {
  const isPCD = url.toLowerCase().endsWith('.pcd');
  const isPLY = url.toLowerCase().endsWith('.ply') || url.startsWith('blob:'); // Assume blob URLs are PLY
  const geometry = isPLY ? useLoader(PLYLoader, url) : null;
  const points = isPCD ? useLoader(PCDLoader, url) : null;
  const scene = !isPCD && !isPLY ? useGLTF(url).scene : null;

  if (isPLY && geometry) {
    return (
      <points geometry={geometry}>
		<pointsMaterial vertexColors size={1} sizeAttenuation={false} />
      </points>
    );
  }
  if (points) {
    return <primitive object={points} />;
  }
  if (scene) {
    return <primitive object={scene} />;
  }
  return null;
}

// Camera controller for WASD movement
function CameraController({
  controlsRef,
  isFocused
}: {
  controlsRef: React.RefObject<any>;
  isFocused: boolean;
}): null {
  const { camera } = useThree();
  const [, get] = useKeyboardControls();
  const moveSpeed = 0.05;

  useFrame(() => {
    // Only process keyboard input when viewer is focused
    if (!isFocused) return;

    const { forward, backward, left, right, up, down } = get();

    // Check if any movement key is pressed
    if (!forward && !backward && !left && !right && !up && !down) {
      return;
    }

    const controls = controlsRef.current;
    if (!controls) return;

    // Create movement vector
    const direction = new THREE.Vector3();
    const right_vec = new THREE.Vector3();
    const movement = new THREE.Vector3();

    // Get camera's forward and right vectors
    camera.getWorldDirection(direction);
    right_vec.crossVectors(camera.up, direction).normalize();

    // Calculate total movement
    if (forward) {
      movement.addScaledVector(direction, moveSpeed);
    }
    if (backward) {
      movement.addScaledVector(direction, -moveSpeed);
    }
    if (left) {
      movement.addScaledVector(right_vec, moveSpeed);
    }
    if (right) {
      movement.addScaledVector(right_vec, -moveSpeed);
    }
    if (up) {
      movement.y += moveSpeed;
    }
    if (down) {
      movement.y -= moveSpeed;
    }

    // Move both camera and target together (true pan)
    camera.position.add(movement);
    controls.target.add(movement);
    controls.update();
  });

  return null;
}

// Component to capture camera reference
function CameraCapture({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }): null {
  const { camera } = useThree();
  cameraRef.current = camera;
  return null;
}

export const GLBViewer = forwardRef<GLBViewerControls, GLBViewerProps>(({ filePath, uploadedGlbs }, ref) => {
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Auto-focus when viewer becomes visible
  useEffect(() => {
    if (filePath && containerRef.current) {
      containerRef.current.focus();
    }
  }, [filePath]);

  // Expose control methods via ref
  useImperativeHandle(ref, () => ({
    setCameraPosition: (x: number, y: number, z: number) => {
      if (cameraRef.current) {
        cameraRef.current.position.set(x, y, z);
        controlsRef.current?.update();
      }
    },
    setCameraTarget: (x: number, y: number, z: number) => {
      if (controlsRef.current) {
        controlsRef.current.target.set(x, y, z);
        controlsRef.current.update();
      }
    },
    resetCamera: () => {
      if (cameraRef.current && controlsRef.current) {
        cameraRef.current.position.set(0.75, 0.75, 1);
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
    },
    focusOnPoint: (x: number, y: number, z: number) => {
      if (cameraRef.current && controlsRef.current) {
        // Move camera to look at the point from a good viewing angle
        const offset = new THREE.Vector3(0.5, 0.5, 0.5);
        cameraRef.current.position.set(x + offset.x, y + offset.y, z + offset.z);
        controlsRef.current.target.set(x, y, z);
        controlsRef.current.update();
      }
    },
    focus: () => {
      containerRef.current?.focus();
    },
  }));

  // Convert file path to file:// URL and memoize it
  const fileUrl = useMemo(() => {
    if (!filePath) return null;
    if (filePath.startsWith('blob:')) return filePath;
    return `file://${filePath}`;
  }, [filePath]);

  // Keyboard controls map
  const keyboardMap = useMemo(
    () => [
      { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
      { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
      { name: 'left', keys: ['KeyA', 'ArrowLeft'] },
      { name: 'right', keys: ['KeyD', 'ArrowRight'] },
      { name: 'up', keys: ['Space'] },
      { name: 'down', keys: ['ShiftLeft', 'ShiftRight'] },
    ],
    []
  );

  if (!fileUrl && (!uploadedGlbs || uploadedGlbs.length === 0)) {
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
        >
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={1}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />

          <Suspense
            fallback={
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="gray" wireframe />
              </mesh>
            }
          >
            {uploadedGlbs && uploadedGlbs.length > 0
              ? uploadedGlbs.map((glbUrl, index) => (
                  <Model key={index} url={glbUrl} />
                ))
              : fileUrl && <Model url={fileUrl} />}
            <ContactShadows
              position={[0, -0.8, 0]}
              opacity={0.25}
              scale={10}
              blur={1.5}
              far={0.8}
            />
            <Environment preset="city" />
          </Suspense>

          <CameraCapture cameraRef={cameraRef} />
          <CameraController controlsRef={controlsRef} isFocused={isFocused} />
          <TrackballControls
            ref={controlsRef}
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
