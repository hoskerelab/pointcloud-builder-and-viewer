// components/ViewerTools.tsx
import React from 'react';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { MousePointer, Ruler, RotateCcw, Plus, Minus, 
  SquareDashedMousePointer, 
  Undo2, 
  Redo2, 
  Trash2 } from 'lucide-react';

type ToolMode = 'navigate' | 'distance' | 'area';

interface ViewerToolsProps {
  toolMode: ToolMode;
  onSetToolMode: (mode: ToolMode) => void;
  onSetOrientation: (euler: THREE.Euler) => void;
  onReset: () => void;
  pointSize: number;
  onSetPointSize: (setter: (prevSize: number) => number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearMeasurements: () => void;
}

// Define common orientations
const Y_UP = new THREE.Euler(0, 0, 0);
const Z_UP = new THREE.Euler(-Math.PI / 2, 0, 0); // Rotate -90 deg on X-axis

export function ViewerTools({ 
    toolMode, 
    onSetToolMode, 
    onSetOrientation, 
    onReset, 
    pointSize,
    onSetPointSize,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onClearMeasurements
}: ViewerToolsProps) {

  const increaseSize = () => {
    // Increase size, cap at 10
    onSetPointSize((s) => Math.min(s + 0.5, 10));
  };
  const decreaseSize = () => {
    // Decrease size, floor at 0.5
    onSetPointSize((s) => Math.max(s - 0.5, 0.5));
  };

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
      
      {/* Tool Mode Toggle */}
      <div className="flex flex-col items-center p-2 bg-background/80 border border-border rounded-lg shadow-lg backdrop-blur-sm">
        <Button variant={toolMode === 'navigate' ? 'secondary' : 'ghost'} size="icon" title="Navigate" onClick={() => onSetToolMode('navigate')}>
          <MousePointer className="h-4 w-4" />
        </Button>
        <Button variant={toolMode === 'distance' ? 'secondary' : 'ghost'} size="icon" title="Distance" onClick={() => onSetToolMode('distance')}>
          <Ruler className="h-4 w-4" />
        </Button>
        <Button variant={toolMode === 'area' ? 'secondary' : 'ghost'} size="icon" title="Area" onClick={() => onSetToolMode('area')}>
          <SquareDashedMousePointer className="h-4 w-4" />
        </Button>
      </div>

      {/* Measurement Actions (Undo/Redo/Clear) */}
      <div className="flex flex-col items-center p-2 bg-background/80 border border-border rounded-lg shadow-lg backdrop-blur-sm">
        <div className="flex gap-1 mb-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onUndo} disabled={!canUndo} title="Undo Point">
                <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRedo} disabled={!canRedo} title="Redo Point">
                <Redo2 className="h-4 w-4" />
            </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-full text-destructive hover:text-destructive" onClick={onClearMeasurements} title="Clear Measurements">
            <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* View Controls */}
      <div className="flex flex-col items-center p-2 bg-background/80 border border-border rounded-lg shadow-lg backdrop-blur-sm">
        <Button variant="ghost" size="sm" onClick={onReset} className="w-full justify-start gap-2">
          <RotateCcw className="h-4 w-4" /> Reset Viewer
        </Button>
        <div className="h-px w-full bg-border my-1" />
        <Button variant="ghost" size="sm" onClick={() => onSetOrientation(Y_UP)} className="w-full justify-start gap-2">Y-Up</Button>
        <Button variant="ghost" size="sm" onClick={() => onSetOrientation(Z_UP)} className="w-full justify-start gap-2">Z-Up</Button>
      </div>

      {/* Point Size */}
      <div className="flex flex-col items-center p-2 bg-background/80 border border-border rounded-lg shadow-lg backdrop-blur-sm">
        <span className="text-[10px] font-medium text-muted-foreground mb-1">Point Size</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={decreaseSize}><Minus className="h-3 w-3" /></Button>
          <span className="text-xs font-mono w-8 text-center">{pointSize.toFixed(1)}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={increaseSize}><Plus className="h-3 w-3" /></Button>
        </div>
      </div>

    </div>
  );
}