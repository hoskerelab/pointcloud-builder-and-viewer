// hooks/useNavGraph.ts

import React from 'react';
// Correct import from the root 'lib' directory
import { buildNavGraph, NavGraph } from '@/lib/navGraph'; 
import type { SceneData } from '@/src/types/scene';

/**
 * A hook that pre-computes the full navigation graph for a scene
 * and provides a loading/ready state.
 */
export function useNavGraph(sceneData: SceneData | null): { navGraph: NavGraph | null; ready: boolean } {
  const [navGraph, setNavGraph] = React.useState<NavGraph | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!sceneData) {
      setNavGraph(null);
      setReady(false);
      return;
    }

    // Set ready to false immediately while we compute
    setReady(false);

    // Run the expensive, one-time computation.
    const compute = async () => {
      try {
        const graph = buildNavGraph(sceneData);
        setNavGraph(graph);
      } catch (e) {
        console.error("Failed to build nav graph:", e);
        setNavGraph(null);
      } finally {
        setReady(true);
      }
    };
    
    // Start the computation
    compute();

  }, [sceneData]);

  return { navGraph, ready };
}