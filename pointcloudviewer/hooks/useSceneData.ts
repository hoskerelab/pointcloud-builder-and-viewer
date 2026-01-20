import { useEffect, useState } from 'react';
// import path from 'path'; // Node.js path module not available in renderer
import { Buffer } from 'buffer';
import { parseNpy } from '@/lib/npy';
import type { SceneCamera, SceneData, SceneImage, SceneMetadata } from '@/src/types/scene';

/**
* Replicates Node's `path.basename` in the renderer, handling both / and \.
* This is needed because we can't use the 'path' module directly, and we
* need a synchronous version for mapping/reducing.
*/

const getBasename = (p: string) => p.split(/[/\\]/).pop() ?? '';


interface SceneDataState {
  data: SceneData | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SceneDataState = {
  data: null,
  loading: false,
  error: null,
};

const NAV_DEBUG = true;
const NAV_GRAPH_RADIUS = 5;
const NAV_GRAPH_NEIGHBORS = 6;
const INTRINSIC_MIN_FOCAL = 50;

function normalizeToArrayBuffer(source: ArrayBuffer | Buffer | { type: string; data: number[] } | null): ArrayBuffer | null {
  if (!source) return null;
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) {
    const view = source as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (typeof Buffer !== 'undefined' && source instanceof Buffer) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  }
  if (typeof source === 'object' && 'type' in source && (source as { type: string }).type === 'Buffer') {
    const raw = Uint8Array.from((source as { data: number[] }).data);
    return raw.buffer;
  }
  return null;
}

function reshapeMatrix(data: Float32Array | Float64Array, index: number, rows: number, cols: number): number[][] {
  const matrix: number[][] = [];
  const stride = rows * cols;
  const offset = index * stride;

  for (let r = 0; r < rows; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < cols; c += 1) {
      row.push(data[offset + r * cols + c]);
    }
    matrix.push(row);
  }

  return matrix;
}

function reshapeMatrices(data: Float32Array | Float64Array, shape: number[], rows: number, cols: number): number[][][] {
  if (shape.length < 2) {
    throw new Error('Unexpected NPY shape for matrix data');
  }

  const matrixCount = data.length / (rows * cols);
  const matrices: number[][][] = [];

  for (let i = 0; i < matrixCount; i += 1) {
    matrices.push(reshapeMatrix(data, i, rows, cols));
  }

  return matrices;
}

function matrixTranspose(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const transposed: number[][] = Array.from({ length: cols }, () => Array(rows).fill(0));

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      transposed[c][r] = matrix[r][c];
    }
  }

  return transposed;
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, idx) => sum + value * vector[idx], 0));
}

function decomposeExtrinsicsW2C(matrix: number[][]): {
  rotationW2C: number[][];
  translationW2C: [number, number, number];
  extrinsicsW2C: number[][];
  rotationC2W: number[][];
  positionWorld: [number, number, number];
  extrinsicsC2W: number[][];
} {
  const rotationW2C = Array.from({ length: 3 }, (_, row) => [
    matrix[row]?.[0] ?? 0,
    matrix[row]?.[1] ?? 0,
    matrix[row]?.[2] ?? 0,
  ]);
  const translationW2C: [number, number, number] = [
    matrix[0]?.[3] ?? 0,
    matrix[1]?.[3] ?? 0,
    matrix[2]?.[3] ?? 0,
  ];

  const rotationC2W = matrixTranspose(rotationW2C);
  const positionWorld = rotationC2W.map((row) => {
    const dot = row[0] * translationW2C[0] + row[1] * translationW2C[1] + row[2] * translationW2C[2];
    return -dot;
  }) as [number, number, number];

  const extrinsicsC2W = rotationC2W.map((row, idx) => [...row, positionWorld[idx] ?? 0]);
  const extrinsicsW2C = rotationW2C.map((row, idx) => [...row, translationW2C[idx] ?? 0]);

  return {
    rotationW2C,
    translationW2C,
    extrinsicsW2C,
    rotationC2W,
    positionWorld,
    extrinsicsC2W,
  };
}

function sanitizeIntrinsics(matrix: number[][], cameraIndex: number): number[][] {
  // Don’t modify K — just copy for safety
  const K = matrix.map((row) => row.slice());
  const fx = K[0]?.[0] ?? 0;
  const fy = K[1]?.[1] ?? 0;
  const cx = K[0]?.[2] ?? 0;
  const cy = K[1]?.[2] ?? 0;

  if (NAV_DEBUG) {
    const estW = (cx * 2).toFixed(0);
    const estH = (cy * 2).toFixed(0);
    console.log(
      `[NavGraph] Camera ${cameraIndex} intrinsics fx=${fx.toFixed(2)}, fy=${fy.toFixed(
        2
      )}, cx=${cx.toFixed(2)}, cy=${cy.toFixed(2)} (≈ ${estW}x${estH})`
    );
  }

  // Only warn, don’t alter values
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) {
    console.warn(
      `[NavGraph] Camera ${cameraIndex} intrinsics contain non-finite focal lengths (fx=${fx}, fy=${fy}).`
    );
  }

  if (NAV_DEBUG) {
    const row2 = K[2] ?? [];
    if (
      Math.abs((row2[0] ?? 0)) > 1e-6 ||
      Math.abs((row2[1] ?? 0)) > 1e-6 ||
      Math.abs((row2[2] ?? 1) - 1) > 1e-6
    ) {
      console.warn(
        `[NavGraph] Camera ${cameraIndex} intrinsics bottom row differs from [0,0,1]: [${row2
          .map((v) => v.toFixed?.(3) ?? String(v))
          .join(', ')}]`
      );
    }
  }

  // Return exactly what was loaded
  return K;
}

function buildSceneImages(scenePath: string, metadata: SceneMetadata | null, imagePaths: string[]): SceneImage[] {
  const imagesByName = new Map<string, string>();
  imagePaths.forEach((absolutePath) => {
    imagesByName.set(getBasename(absolutePath), absolutePath);
  });

  if (!metadata) {
    return imagePaths.map((absolutePath, index) => ({
      index,
      name: getBasename(absolutePath),
      absolutePath,
    }));
  }

  const ordered: SceneImage[] = metadata.input_images.map((entry) => {
    const name = getBasename(entry.path);
    const absolutePath = imagesByName.get(name) ?? null;
    return {
      index: entry.index,
      name,
      metadataPath: entry.path,
      absolutePath,
    };
  });

  // Append any images not referenced in metadata
  imagePaths.forEach((absolutePath, index) => {
    const name = getBasename(absolutePath);
    if (!ordered.some((img) => img.absolutePath === absolutePath)) {
      ordered.push({
        index: metadata.image_count + index,
        name,
        absolutePath,
      });
    }
  });

  return ordered;
}

export interface ImageCoordinates {
  u: number;
  v: number;
  z: number;
}

export function projectWorldPointToImage(
  extrinsics: number[][],
  intrinsics: number[][],
  worldPoint: [number, number, number]
): ImageCoordinates | null {
  if (!extrinsics || extrinsics.length < 3 || !intrinsics || intrinsics.length < 3) {
    return null;
  }

  const rotation = extrinsics.map((row) => row.slice(0, 3));
  const translation = extrinsics.map((row) => row[3] ?? 0);

  const cameraX =
    (rotation[0]?.[0] ?? 0) * worldPoint[0] +
    (rotation[0]?.[1] ?? 0) * worldPoint[1] +
    (rotation[0]?.[2] ?? 0) * worldPoint[2] +
    translation[0];
  const cameraY =
    (rotation[1]?.[0] ?? 0) * worldPoint[0] +
    (rotation[1]?.[1] ?? 0) * worldPoint[1] +
    (rotation[1]?.[2] ?? 0) * worldPoint[2] +
    translation[1];
  const cameraZ =
    (rotation[2]?.[0] ?? 0) * worldPoint[0] +
    (rotation[2]?.[1] ?? 0) * worldPoint[1] +
    (rotation[2]?.[2] ?? 0) * worldPoint[2] +
    translation[2];

  if (!Number.isFinite(cameraZ) || cameraZ <= 0) {
    return null;
  }

  const k00 = intrinsics[0]?.[0] ?? 0;
  const k01 = intrinsics[0]?.[1] ?? 0;
  const k02 = intrinsics[0]?.[2] ?? 0;
  const k10 = intrinsics[1]?.[0] ?? 0;
  const k11 = intrinsics[1]?.[1] ?? 0;
  const k12 = intrinsics[1]?.[2] ?? 0;
  const k20 = intrinsics[2]?.[0] ?? 0;
  const k21 = intrinsics[2]?.[1] ?? 0;
  const k22 = intrinsics[2]?.[2] ?? 1;

  if (NAV_DEBUG && (k20 !== 0 || k21 !== 0 || k22 !== 1)) {
    console.warn('[NavGraph] Intrinsics third row is not [0,0,1]; projection may be invalid.');
  }

  const projectedX = k00 * cameraX + k01 * cameraY + k02 * cameraZ;
  const projectedY = k10 * cameraX + k11 * cameraY + k12 * cameraZ;
  const projectedW = k20 * cameraX + k21 * cameraY + k22 * cameraZ;

  if (!Number.isFinite(projectedW) || projectedW === 0) {
    return null;
  }

  const u = projectedX / projectedW;
  const v = projectedY / projectedW;

  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return null;
  }

  return {
    u,
    v,
    z: cameraZ,
  };
}

function buildNavigationGraph(
  cameras: SceneCamera[],
  radius: number = NAV_GRAPH_RADIUS,
  maxNeighbors: number = NAV_GRAPH_NEIGHBORS
) {
  for (let i = 0; i < cameras.length; i += 1) {
    const cameraA = cameras[i];
    const candidates: Array<{ index: number; distance: number }> = [];

    for (let j = 0; j < cameras.length; j += 1) {
      if (i === j) continue;
      const cameraB = cameras[j];

      const dx = cameraB.positionWorld[0] - cameraA.positionWorld[0];
      const dy = cameraB.positionWorld[1] - cameraA.positionWorld[1];
      const dz = cameraB.positionWorld[2] - cameraA.positionWorld[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!Number.isFinite(distance) || distance === 0) {
        continue;
      }

      candidates.push({ index: cameraB.index, distance });
    }

    candidates.sort((a, b) => a.distance - b.distance);

    const selected = new Set<number>();

    for (const candidate of candidates) {
      if (candidate.distance <= radius) {
        selected.add(candidate.index);
      }
      if (selected.size >= maxNeighbors) {
        break;
      }
    }

    if (selected.size < maxNeighbors) {
      for (const candidate of candidates) {
        if (selected.has(candidate.index)) continue;
        selected.add(candidate.index);
        if (selected.size >= maxNeighbors) break;
      }
    }

    const neighbors = Array.from(selected);
    if (NAV_DEBUG) {
      console.log(`[NavGraph] Camera ${cameraA.index} found ${neighbors.length} neighbors: [${neighbors.join(', ')}]`);
    }
    cameraA.navigableNeighbors = neighbors;
  }
}

function buildSceneCameras(
  extrinsicsMatrices: number[][][],
  intrinsicsMatrices: number[][][],
  poseEncodings: (number[] | null)[],
  images: SceneImage[]
): SceneCamera[] {
  const cameraCount = Math.min(extrinsicsMatrices.length, intrinsicsMatrices.length);
  const cameras: SceneCamera[] = [];

  for (let i = 0; i < cameraCount; i += 1) {
    const extrW2C = extrinsicsMatrices[i];
    const intr = intrinsicsMatrices[i];
    const {
      rotationW2C,
      translationW2C,
      extrinsicsW2C,
      rotationC2W,
      positionWorld,
      extrinsicsC2W,
    } = decomposeExtrinsicsW2C(extrW2C);
    const sanitizedIntrinsics = sanitizeIntrinsics(intr, i);

    const associatedImage = images.find((img) => img.index === i) ?? null;

    // --- [DEBUG LOG] ADD THIS BLOCK ---
    if (NAV_DEBUG) {
      console.group(`[Camera ${i}]`);
      console.log('Intrinsics (K):', sanitizedIntrinsics);
      console.log('Extrinsics (W2C):', extrinsicsW2C);
      console.log('--- DERIVED ---');
      console.log('Position (World):', positionWorld);
      console.log('Rotation (C2W):', rotationC2W);
      console.groupEnd();
    }
    // --- END DEBUG LOG ---

    cameras.push({
      index: i,
      extrinsics: extrinsicsW2C,
      extrinsicsC2W,
      extrinsicsW2C,
      rotationC2W,
      rotationW2C,
      intrinsics: sanitizedIntrinsics,
      position: positionWorld,
      positionWorld,
      rotationMatrix: rotationW2C,
      poseEncoding: poseEncodings[i],
      image: associatedImage,
      navigableNeighbors: [],
    });
  }

  buildNavigationGraph(cameras);

  if (NAV_DEBUG && cameras.length > 0) {
    const centroid = cameras.reduce(
      (acc, cam) => {
        acc[0] += cam.positionWorld[0];
        acc[1] += cam.positionWorld[1];
        acc[2] += cam.positionWorld[2];
        return acc;
      },
      [0, 0, 0]
    ).map((value) => value / cameras.length) as [number, number, number];

    let facingCount = 0;
    cameras.forEach((cam) => {
      const toCentroid = [
        centroid[0] - cam.positionWorld[0],
        centroid[1] - cam.positionWorld[1],
        centroid[2] - cam.positionWorld[2],
      ];
      const toCentroidLen = Math.hypot(toCentroid[0], toCentroid[1], toCentroid[2]) || 1;
      const toCentroidUnit = toCentroid.map((v) => v / toCentroidLen) as [number, number, number];
      const forwardWorld = [
        cam.rotationC2W[0]?.[2] ?? 0,
        cam.rotationC2W[1]?.[2] ?? 0,
        cam.rotationC2W[2]?.[2] ?? 0,
      ];
      const forwardLen = Math.hypot(forwardWorld[0], forwardWorld[1], forwardWorld[2]) || 1;
      const forwardUnit = forwardWorld.map((v) => v / forwardLen) as [number, number, number];
      const dot =
        forwardUnit[0] * toCentroidUnit[0] +
        forwardUnit[1] * toCentroidUnit[1] +
        forwardUnit[2] * toCentroidUnit[2];
      if (dot > 0) facingCount += 1;
    });

    console.log(
      `[Sanity] cameras facing scene centroid: ${facingCount}/${cameras.length} (~${(
        facingCount / cameras.length
      ).toFixed(2)})`
    );
  }

  return cameras;
}

async function loadPoseEncodings(scenePath: string): Promise<(number[] | null)[]> {
  const posePath = await window.electron.pathJoin(scenePath, 'pose_encoding.npy');

  // --- ADD THIS CHECK ---
  // Check if the file exists before trying to read it
  const stats = await window.electron.getFileStats(posePath);
  if (!stats || !stats.isFile) {
    console.warn(`[useSceneData] pose_encoding.npy not found at ${posePath}, skipping.`);
    return []; // Return an empty array if the file doesn't exist
  }
  // --- END OF CHECK ---

  console.log(`[useSceneData] Requesting pose encoding buffer for: ${posePath}`); // <-- ADDED

  const poseBuffer = await window.electron.readFileBuffer(posePath);

  // --- Start Debug Logs ---
  if (posePath.endsWith('pose_encoding.npy')) {
    console.log('[useSceneData] Received poseBuffer:', poseBuffer);
    if (poseBuffer) {
      console.log(`[useSceneData] poseBuffer type: ${poseBuffer.constructor.name}`);
      console.log(`[useSceneData] poseBuffer byteLength: ${poseBuffer.byteLength}`);
      // Log first 10 bytes as hex to see the signature
      const firstBytes = new Uint8Array(poseBuffer.slice(0, 10));
      console.log(`[useSceneData] poseBuffer first 10 bytes (hex): ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      // Log first 10 bytes as string (latin1)
       try {
         const firstChars = new TextDecoder('latin1').decode(firstBytes);
         console.log(`[useSceneData] poseBuffer first 10 chars (latin1): "${firstChars}"`);
       } catch (e) {
         console.error('[useSceneData] Error decoding first bytes as latin1:', e);
       }
    } else {
      console.warn('[useSceneData] readFileBuffer returned null for pose_encoding.npy');
    }
  }
  // --- End Debug Logs ---

  const poseArrayBuffer = normalizeToArrayBuffer(poseBuffer);

  // --- Start Debug Logs ---
   if (posePath.endsWith('pose_encoding.npy')) {
     console.log('[useSceneData] poseArrayBuffer after normalization:', poseArrayBuffer);
     if (poseArrayBuffer) {
       console.log(`[useSceneData] poseArrayBuffer type: ${poseArrayBuffer.constructor.name}`);
       console.log(`[useSceneData] poseArrayBuffer byteLength: ${poseArrayBuffer.byteLength}`);
       const firstBytesNorm = new Uint8Array(poseArrayBuffer.slice(0, 10));
       console.log(`[useSceneData] poseArrayBuffer first 10 bytes (hex): ${Array.from(firstBytesNorm).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
     } else {
        console.warn('[useSceneData] poseArrayBuffer is null/undefined after normalization');
     }
   }
  // --- End Debug Logs ---
  if (!poseArrayBuffer) {
    return [];
  }

  try {
    const parsed = parseNpy(poseArrayBuffer);
    const stride = parsed.shape.slice(-1)[0] ?? 0;
    const vectorCount = parsed.data.length / stride;
    const vectors: (number[] | null)[] = [];

    for (let i = 0; i < vectorCount; i += 1) {
      const offset = i * stride;
      const vec = Array.from(parsed.data.slice(offset, offset + stride));
      vectors.push(vec);
    }
    return vectors;
  } catch (error) {
    console.warn('Unable to parse pose encoding file:', error);
    return [];
  }
}

export function useSceneData(scenePath: string | null): SceneDataState {
  const [state, setState] = useState<SceneDataState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!scenePath) {
        if (!cancelled) {
          setState(INITIAL_STATE);
        }
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const [metadata, imagePaths] = await Promise.all([
          window.electron.getSceneMetadata(scenePath),
          window.electron.getSceneImages(scenePath),
        ]);

        const metadataTyped = metadata ?? null;
        const images = buildSceneImages(scenePath, metadataTyped, imagePaths ?? []);

        const extrPath = await window.electron.pathJoin(scenePath, 'camera_extrinsics.npy');
        const intrPath = await window.electron.pathJoin(scenePath, 'camera_intrinsics.npy');

        const [extrBuffer, intrBuffer, poseEncodings] = await Promise.all([
          window.electron.readFileBuffer(extrPath),
          window.electron.readFileBuffer(intrPath),
          loadPoseEncodings(scenePath),
        ]);

        const extrArrayBuffer = normalizeToArrayBuffer(extrBuffer);
        const intrArrayBuffer = normalizeToArrayBuffer(intrBuffer);

        if (!extrArrayBuffer || !intrArrayBuffer) {
          throw new Error('Missing camera parameter files');
        }

        const extrParsed = parseNpy(extrArrayBuffer);
        const intrParsed = parseNpy(intrArrayBuffer);

        const extrMatrices = reshapeMatrices(extrParsed.data, extrParsed.shape, 3, 4);
        const intrMatrices = reshapeMatrices(intrParsed.data, intrParsed.shape, 3, 3);

        const cameras = buildSceneCameras(extrMatrices, intrMatrices, poseEncodings, images);

        if (!cancelled) {
          setState({
            data: {
              metadata: metadataTyped,
              images,
              cameras,
            },
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        console.error('Error loading scene data:', error);
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown error loading scene data',
          });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [scenePath]);

  return state;
}
