import React, { createContext, useContext, useRef, ReactNode } from 'react';

export interface GLBViewerControls {
  setCameraPosition: (x: number, y: number, z: number) => void;
  setCameraTarget: (x: number, y: number, z: number) => void;
  resetCamera: () => void;
  focusOnPoint: (x: number, y: number, z: number) => void;
  focus: () => void;
}

export interface SceneGraphViewerControls {
  selectNode: (nodeId: string) => void;
  clearSelection: () => void;
  highlightNodes: (nodeIds: string[]) => void;
  zoomToNode: (nodeId: string) => void;
  resetView: () => void;
  focus: () => void;
}

interface ViewerContextType {
  glbViewerRef: React.RefObject<GLBViewerControls | null>;
  sceneGraphViewerRef: React.RefObject<SceneGraphViewerControls | null>;
}

const ViewerContext = createContext<ViewerContextType | undefined>(undefined);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const glbViewerRef = useRef<GLBViewerControls | null>(null);
  const sceneGraphViewerRef = useRef<SceneGraphViewerControls | null>(null);

  return (
    <ViewerContext.Provider value={{ glbViewerRef, sceneGraphViewerRef }}>
      {children}
    </ViewerContext.Provider>
  );
}

export function useViewerControls(): ViewerContextType {
  const context = useContext(ViewerContext);
  if (!context) {
    throw new Error('useViewerControls must be used within a ViewerProvider');
  }
  return context;
}
