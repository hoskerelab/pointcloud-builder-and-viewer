// lib/navGraph.ts

import type { SceneData, SceneCamera, SceneImage } from '@/src/types/scene';

export interface NavPair {
  left?: number;   // camera index
  right?: number;  // camera index
}

// This NavGraph stores the *camera index* of the best left/right neighbor
// for every other camera index in the scene.
export type NavGraph = Record<number, NavPair>;

/**
 * Build a left/right navigation graph for all cameras in the scene.
 * This runs once when the sceneData is loaded.
 */
export function buildNavGraph(sceneData: SceneData): NavGraph {
  const navGraph: NavGraph = {};
  const cameras = sceneData.cameras ?? [];

  // Helper to get camera by index quickly
  const camByIndex = new Map<number, SceneCamera>();
  for (const cam of cameras) {
    camByIndex.set(cam.index, cam);
  }

  // Iterate over EVERY camera in the scene
  for (const currentCamera of cameras) {
    const rotation = currentCamera.rotationW2C;
    const currentPosition = currentCamera.positionWorld ?? currentCamera.position;

    // If camera has no data, give it no neighbors
    if (!rotation || !currentPosition || !currentCamera.navigableNeighbors) {
      navGraph[currentCamera.index] = {};
      continue;
    }

    const candidates: { side: 'left' | 'right'; dist: number; idx: number }[] = [];

    // Check all of its 6 pre-calculated neighbors
    for (const neighborIndex of currentCamera.navigableNeighbors) {
      const neighborCamera = camByIndex.get(neighborIndex);
      if (!neighborCamera) continue;

      const neighborPosition = neighborCamera.positionWorld ?? neighborCamera.position;
      if (!neighborPosition) continue;

      const dx = neighborPosition[0] - currentPosition[0];
      const dy = neighborPosition[1] - currentPosition[1];
      const dz = neighborPosition[2] - currentPosition[2];

      const dist = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(dist) || dist === 0) continue;

      // Transform delta into camera coordinates using rotationW2C
      const camX =
        (rotation[0]?.[0] ?? 0) * dx +
        (rotation[0]?.[1] ?? 0) * dy +
        (rotation[0]?.[2] ?? 0) * dz;
      const camZ =
        (rotation[2]?.[0] ?? 0) * dx +
        (rotation[2]?.[1] ?? 0) * dy +
        (rotation[2]?.[2] ?? 0) * dz;
      
      // Robustness fix: Only reject if "mostly behind"
      if (Math.abs(camX) < Math.abs(camZ) && camZ <= 0) {
         continue; // Reject as "mostly behind"
      }

      // Also reject degenerate alignment
      if (!Number.isFinite(camX) || Math.abs(camX) < 1e-6) {
        continue;
      }

      const side: 'left' | 'right' = camX > 0 ? 'right' : 'left';

      candidates.push({ side, dist, idx: neighborIndex });
    }

    // Pick the *closest* neighbor for each side
    let bestLeft: { dist: number; idx: number } | undefined;
    let bestRight: { dist: number; idx: number } | undefined;

    for (const c of candidates) {
      if (c.side === 'left') {
        if (!bestLeft || c.dist < bestLeft.dist) {
          bestLeft = { dist: c.dist, idx: c.idx };
        }
      } else {
        if (!bestRight || c.dist < bestRight.dist) {
          bestRight = { dist: c.dist, idx: c.idx };
        }
      }
    }

    // Store the result
    navGraph[currentCamera.index] = {
      left: bestLeft?.idx,
      right: bestRight?.idx,
    };
  }

  console.log('[useNavGraph] Pre-computed navigation graph:', navGraph);
  return navGraph;
}