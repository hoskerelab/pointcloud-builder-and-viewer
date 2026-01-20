// components/MeasurementOverlay.tsx
import React, { useMemo, useEffect } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

interface MeasurementOverlayProps {
  points: THREE.Vector3[];
}

// Helper for A, B, C labels
const getLabel = (index: number) => String.fromCharCode(65 + index);

// Renders a sphere at a specific 3D position
function Marker({ position, label }: { position: THREE.Vector3; label?: string }) {
  return (
    <group position={position}>
      <mesh>
        {/* Adjust radius (0.015) based on your scene scale */}
        <sphereGeometry args={[0.025, 32, 32]} />
        <meshStandardMaterial 
            color="#ef4444" 
            emissive="#ef4444" 
            emissiveIntensity={0.5} 
            transparent={true}
            opacity={0.6}
        />
      </mesh>
      {label && (
        <Html position={[0, 0.05, 0]} center>
          <div className="px-2 py-1 bg-black/80 text-white text-xs rounded pointer-events-none whitespace-nowrap">
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

function PolygonMesh({ points, area }: { points: THREE.Vector3[], area: number }) {
  const geometry = useMemo(() => {
    if (points.length < 3) return null;
    
    const shape = new THREE.Shape();
    // Note: This is a simple projection. For strict 3D coplanarity, 
    // we ideally rotate points to a 2D plane. 
    // For this viewer, we construct a geometry via BufferAttribute to support 3D vertices.
    
    // Simple Triangle Fan from Point 0 (works for convex shapes)
    const indices = [];
    const vertices = [];
    
    // Push vertices
    points.forEach(p => vertices.push(p.x, p.y, p.z));

    // Create indices (0, 1, 2), (0, 2, 3), etc.
    for (let i = 1; i < points.length - 1; i++) {
        indices.push(0, i, i + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [points]);

  // Line Loop for outline
  const lineGeo = useMemo(() => {
      return new THREE.BufferGeometry().setFromPoints([...points, points[0]]);
  }, [points]);

  // Calculate Center for Label
  const center = useMemo(() => {
      const c = new THREE.Vector3();
      points.forEach(p => c.add(p));
      c.divideScalar(points.length);
      return c;
  }, [points]);

  if (!geometry) return null;

  return (
    <group>
        {/* Transparent Fill */}
        <mesh geometry={geometry}>
            <meshBasicMaterial color="#ef4444" transparent opacity={0.3} side={THREE.DoubleSide} depthTest={false} />
        </mesh>
        {/* Outline */}
        <line geometry={lineGeo}>
            <lineBasicMaterial color="#ff9999" linewidth={2} />
        </line>
        {/* Label */}
        <Html position={center} center>
            <div className="px-2 py-1 bg-black/80 text-white text-xs font-mono rounded border border-red-500 pointer-events-none whitespace-nowrap backdrop-blur-md">
                {area.toFixed(2)} units²
            </div>
        </Html>
    </group>
  );
}

// Renders the line and the distance label
function DistanceLine({ start, end }: { start: THREE.Vector3; end: THREE.Vector3 }) {
  const distance = start.distanceTo(end);
  const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

  // Create geometry for the line
  const lineGeometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([start, end]);
  }, [start, end]);

  useEffect(() => {
    return () => lineGeometry.dispose();
  }, [lineGeometry]);

  return (
    <group>
      <line geometry={lineGeometry}>
        <lineBasicMaterial color="#ef4444" linewidth={2} depthTest={false} opacity={0.8} transparent />
      </line>
      
      <Html position={midPoint} center>
        <div className="px-2 py-1 bg-black/80 text-white text-xs font-mono rounded border border-red-500 pointer-events-none whitespace-nowrap backdrop-blur-md">
          {distance.toFixed(3)} units
        </div>
      </Html>
    </group>
  );
}

export function MeasurementOverlay({ points }: MeasurementOverlayProps) {
  if (points.length === 0) return null;
  
  // 1. Calculate Area
  const area = useMemo(() => {
    if (points.length < 3) return 0;
    let totalArea = 0;
    const v0 = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const v1 = points[i];
      const v2 = points[i + 1];
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const cross = new THREE.Vector3().crossVectors(edge1, edge2);
      totalArea += cross.length() * 0.5;
    }
    return totalArea;
  }, [points]);

  // 2. Determine Mode based on Data
  const isPolygon = points.length >= 3;

  return (
    <group>
      {/* Markers */}
      {points.map((p, i) => (
          <Marker key={i} position={p} label={getLabel(i)} />
      ))}

      {/* Persistence Logic: If >= 3 points, it's a polygon. Else it's lines. */}
      {isPolygon ? (
          <PolygonMesh points={points} area={area} />
      ) : (
          points.map((p, i) => {
              if (i === 0) return null;
              return <DistanceLine key={i} start={points[i-1]} end={p} />;
          })
      )}
      
      {/* Visual Hint: If exactly 2 points, show the distance line */}
      {points.length === 2 && (
          <DistanceLine start={points[0]} end={points[1]} />
      )}
    </group>
  );
}