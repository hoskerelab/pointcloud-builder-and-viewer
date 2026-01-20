// components/SegmentationLayer.tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

interface SegmentationPolygon {
  label: string;
  points: { x: number; y: number; z: number }[];
  area: number;
}

interface SegmentationLayerProps {
  polygons: SegmentationPolygon[];
}

export function SegmentationLayer({ polygons }: SegmentationLayerProps) {
  return (
    <group>
      {polygons.map((poly, idx) => (
        <SinglePolygon key={idx} data={poly} />
      ))}
    </group>
  );
}

function SinglePolygon({ data }: { data: SegmentationPolygon }) {
  const { geometry, center } = useMemo(() => {
    if (data.points.length < 3) return { geometry: null, center: new THREE.Vector3() };

    // Convert points to Vector3
    const vecs = data.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    
    // Calculate center for the label
    const center = new THREE.Vector3();
    vecs.forEach(v => center.add(v));
    center.divideScalar(vecs.length);

    // Create a shape. Note: This assumes points are roughly coplanar.
    // For complex 3D scans, convex hull or projecting to a plane is safer.
    const shape = new THREE.Shape();
    shape.moveTo(vecs[0].x, vecs[0].z); // Projecting to XZ plane for simple floor plans
    for (let i = 1; i < vecs.length; i++) {
        shape.lineTo(vecs[i].x, vecs[i].z);
    }
    shape.closePath();

    // Create 3D geometry from shape
    // Note: We use the Y value from the first point as the height
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // Rotate to lie flat
    geo.translate(0, vecs[0].y, 0); // Move to correct height

    return { geometry: geo, center };
  }, [data.points]);

  if (!geometry) return null;

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#00ff88" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#00ff88" />
      </lineSegments>
      
      <Html position={center}>
        <div className="bg-black/80 text-white text-xs p-1 rounded backdrop-blur-md border border-green-500/50">
            <div className="font-bold">{data.label}</div>
            <div className="text-[10px]">{data.area.toFixed(2)} m²</div>
        </div>
      </Html>
    </group>
  );
}