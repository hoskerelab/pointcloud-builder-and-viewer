import React, { useState, useEffect, useCallback, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel';
import { XIcon, ArrowLeftIcon } from 'lucide-react';
import type { SceneGraphViewerControls } from '@/src/contexts/ViewerContext';

interface SceneGraphViewerProps {
  scenePath: string | null;
  isVisible?: boolean;
}

interface GraphNode {
  id: string;
  name: string;
  focus: string;
  description: string;
  imageUrl: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string;
  target: string;
  description: string;
  distance: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const SceneGraphViewer = forwardRef<SceneGraphViewerControls, SceneGraphViewerProps>(({ scenePath, isVisible }, ref) => {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ path: string; name: string } | null>(null);
  const [connectedNodes, setConnectedNodes] = useState<Set<string>>(new Set());
  const [dialogSize, setDialogSize] = useState({ width: 800, height: 600 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulseAnimation, setPulseAnimation] = useState(0);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isFocused, setIsFocused] = useState(false);
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const hasConfiguredForces = useRef(false);
  const hasInitiallyFitted = useRef(false);
  const resizeRef = useRef<{ isResizing: boolean; startX: number; startY: number; startWidth: number; startHeight: number }>({
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
  });

  // Expose control methods via ref
  useImperativeHandle(ref, () => ({
    selectNode: (nodeId: string) => {
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (node) {
        handleNodeClick(node);
      }
    },
    clearSelection: () => {
      setSelectedNode(null);
      setConnectedNodes(new Set());
    },
    highlightNodes: (nodeIds: string[]) => {
      const nodeSet = new Set(nodeIds);
      setConnectedNodes(nodeSet);
    },
    zoomToNode: (nodeId: string) => {
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (node && graphRef.current) {
        // Center camera on node
        graphRef.current.centerAt(node.x, node.y, 1000);
        graphRef.current.zoom(3, 1000);
        handleNodeClick(node);
      }
    },
    resetView: () => {
      setSelectedNode(null);
      setConnectedNodes(new Set());
      if (graphRef.current) {
        graphRef.current.zoomToFit(400);
      }
    },
    focus: () => {
      containerRef.current?.focus();
    },
  }), [graphData.nodes]);

  // Get list of connected nodes (excluding the selected node itself)
  const connectedNodesList = useMemo(() => {
    if (!selectedNode) return [];
    return graphData.nodes.filter(node =>
      connectedNodes.has(node.id) && node.id !== selectedNode.id
    );
  }, [selectedNode, connectedNodes, graphData.nodes]);

  useEffect(() => {
    const loadSceneGraph = async () => {
      if (!scenePath) {
        setGraphData({ nodes: [], links: [] });
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const sceneGraphPath = await window.electron.getSceneGraphPath(scenePath);
        if (!sceneGraphPath) {
          setError('Scene graph file not found');
          setLoading(false);
          return;
        }

        const sceneGraph = await window.electron.readSceneGraph(sceneGraphPath);
        if (!sceneGraph || !sceneGraph.nodes) {
          setError('Failed to load scene graph');
          setLoading(false);
          return;
        }

        // Transform data for react-force-graph
        const nodes: GraphNode[] = sceneGraph.nodes.map((node: any) => ({
          id: node.image_name,
          name: node.image_name,
          focus: node.central_focus,
          description: node.image_description,
          imageUrl: `file://${scenePath}/images/${node.image_name}`,
        }));

        const links: GraphLink[] = [];
        sceneGraph.nodes.forEach((node: any) => {
          node.edges.forEach((edge: any) => {
            // Only add link if target node exists
            if (nodes.find(n => n.id === edge.connected_to)) {
              links.push({
                source: node.image_name,
                target: edge.connected_to,
                description: edge.description_of_connection,
                distance: 300, // Optimal spacing for larger thumbnail visualization
              });
            }
          });
        });

        setGraphData({ nodes, links });
        // Reset flags for new data
        hasConfiguredForces.current = false;
        hasInitiallyFitted.current = false;
      } catch (err) {
        console.error('Error loading scene graph:', err);
        setError('Failed to load scene graph');
      } finally {
        setLoading(false);
      }
    };

    loadSceneGraph();
  }, [scenePath]);

  // Pre-load all node images for thumbnail rendering
  useEffect(() => {
    if (graphData.nodes.length === 0) return;

    const loadImages = async () => {
      const cache = new Map<string, HTMLImageElement>();
      const loadPromises = graphData.nodes.map((node) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            cache.set(node.id, img);
            resolve();
          };
          img.onerror = () => {
            console.error(`Failed to load image for node ${node.id}`);
            resolve(); // Continue even if one image fails
          };
          img.src = node.imageUrl;
        });
      });

      try {
        await Promise.all(loadPromises);
        imageCache.current = cache;
        setImagesLoaded(true);
      } catch (err) {
        console.error('Failed to load node images:', err);
      }
    };

    loadImages();
    setImagesLoaded(false);
  }, [graphData.nodes]);

  // Animation loop for pulsing effect when hovering carousel images
  useEffect(() => {
    if (!hoveredNode) return;

    let animationFrameId: number;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const pulse = (Math.sin(elapsed / 300) + 1) / 2; // Oscillates between 0 and 1
      setPulseAnimation(pulse);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [hoveredNode]);

  // Track container size changes with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      // Only update if dimensions are valid (not hidden with display: none)
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    // Set initial dimensions
    updateDimensions();

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Update dimensions when component becomes visible
  useEffect(() => {
    if (isVisible && containerRef.current) {
      // Small delay to ensure CSS has applied
      setTimeout(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height });
        }
      }, 50);
    }
  }, [isVisible]);

  // Force dimension update on window resize
  useEffect(() => {
    if (!isVisible) return;

    const handleResize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isVisible]);

  // Only zoom to fit on initial load, preserve camera position on subsequent resizes
  useEffect(() => {
    if (graphRef.current && dimensions.width > 0 && dimensions.height > 0 && !hasInitiallyFitted.current) {
      // Only zoom to fit once when the graph is first loaded
      setTimeout(() => {
        graphRef.current?.zoomToFit?.(400);
        hasInitiallyFitted.current = true;
      }, 100);
    }
  }, [dimensions]);

  // Configure D3 forces after graph is initialized (only once)
  const handleEngineStop = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || hasConfiguredForces.current) return;

    try {
      // Get all forces
      const chargeForce = graph.d3Force('charge');
      const linkForce = graph.d3Force('link');
      const centerForce = graph.d3Force('center');

      // Configure charge force to push nodes apart
      if (chargeForce) {
        chargeForce.strength(-400); // Negative = repulsion, balanced for moderate density
      }

      // Configure link distance and strength
      if (linkForce) {
        linkForce
          .distance((link: any) => link.distance || 300)
          .strength(0.7); // 0.7 = balanced enforcement (1.0 = rigid, 0.0 = ignored)
      }

      // Keep graph centered
      if (centerForce) {
        centerForce.strength(0.05); // Stronger centering to prevent drift
      }

      // Add collision force to prevent node overlap
      const collisionForce = forceCollide((node: any) => {
        const connectionCount = graphData.links.filter(
          (link: any) => link.source === node.id || link.target === node.id ||
                         link.source.id === node.id || link.target.id === node.id
        ).length;
        const nodeSize = 80 + Math.min(connectionCount * 4, 40);
        return nodeSize + 30; // Node radius + 30px padding for comfortable spacing
      }).strength(0.8); // 0.8 = strong but smooth collision (1.0 can be too rigid)

      graph.d3Force('collision', collisionForce);

      // Restart simulation
      if (graph.d3ReheatSimulation) {
        graph.d3ReheatSimulation();
      }

      // Zoom to fit only on first configuration
      setTimeout(() => {
        if (graphRef.current?.zoomToFit) {
          graphRef.current.zoomToFit(400);
        }
      }, 100);

      // Mark as configured to prevent repeated calls
      hasConfiguredForces.current = true;
    } catch (err) {
      console.error('Error configuring D3 forces:', err);
    }
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);

    // Find all connected nodes
    const connected = new Set<string>();
    graphData.links.forEach((link: any) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;

      if (sourceId === node.id) {
        connected.add(targetId);
      } else if (targetId === node.id) {
        connected.add(sourceId);
      }
    });
    connected.add(node.id); // Include the node itself
    setConnectedNodes(connected);
  }, [graphData.links]);

  const handleNodeImageClick = useCallback((node: GraphNode) => {
    setSelectedImage({
      path: `${scenePath}/images/${node.name}`,
      name: node.name,
    });
  }, [scenePath]);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
  }, []);

  const handleCarouselImageHover = useCallback((node: GraphNode | null) => {
    // Reuse existing hoveredNode state to highlight node in graph
    setHoveredNode(node);
  }, []);

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    resizeRef.current = {
      isResizing: true,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: dialogSize.width,
      startHeight: dialogSize.height,
    };
  };

  useEffect(() => {
    const handleResizeMove = (e: MouseEvent): void => {
      if (!resizeRef.current.isResizing) return;

      const deltaX = e.clientX - resizeRef.current.startX;
      const deltaY = e.clientY - resizeRef.current.startY;

      const newWidth = Math.max(400, Math.min(window.innerWidth * 0.95, resizeRef.current.startWidth + deltaX));
      const newHeight = Math.max(300, Math.min(window.innerHeight * 0.95, resizeRef.current.startHeight + deltaY));

      setDialogSize({ width: newWidth, height: newHeight });
    };

    const handleResizeEnd = (): void => {
      resizeRef.current.isResizing = false;
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, []);

  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isSelected = selectedNode?.id === node.id;
    const isHovered = hoveredNode?.id === node.id;
    const isConnected = connectedNodes.has(node.id);
    const hasSelection = selectedNode !== null;

    // Calculate node size based on connections (larger for thumbnails)
    const connectionCount = graphData.links.filter(
      (link: any) => link.source === node.id || link.target === node.id ||
                     link.source.id === node.id || link.target.id === node.id
    ).length;
    const baseSize = 80; // Doubled base size for larger thumbnails
    const size = baseSize; // 60-100px range

    // Dim non-connected nodes when something is selected
    const alpha = hasSelection && !isConnected ? 0.3 : 1.0;

    // Get image from cache
    const img = imageCache.current.get(node.id);

    if (img && img.complete) {
      ctx.globalAlpha = alpha;
      ctx.save();

      // Create circular clipping path for thumbnail
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.clip();

      // Draw image (fit to circle)
      const imgSize = size * 2; // Diameter
      ctx.drawImage(
        img,
        node.x - size,
        node.y - size,
        imgSize,
        imgSize
      );

      ctx.restore();

      // Draw border for selected/connected/default
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);

      if (isSelected) {
        ctx.strokeStyle = '#3b82f6'; // Blue border
        ctx.lineWidth = 4 / globalScale;
      } else if (isConnected && hasSelection) {
        ctx.strokeStyle = '#10b981'; // Green border
        ctx.lineWidth = 3 / globalScale;
      } else {
        // Subtle white border for all thumbnails
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / globalScale;
      }
      ctx.stroke();
    } else {
      // Fallback: draw placeholder circle while image loads
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = '#374151'; // Gray placeholder
      ctx.fill();

      // Border for placeholder
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }

    // Draw pulsing indicator when hovered from carousel (on top of thumbnail)
    if (isHovered) {
      ctx.globalAlpha = 1.0;

      // Pulsing outer ring
      const pulseSize = size * (1.3 + pulseAnimation * 0.3);
      const pulseOpacity = 0.6 - pulseAnimation * 0.4;

      ctx.globalAlpha = pulseOpacity;
      ctx.beginPath();
      ctx.arc(node.x, node.y, pulseSize, 0, 2 * Math.PI);
      ctx.strokeStyle = '#3b82f6'; // Blue color
      ctx.lineWidth = 4 / globalScale;
      ctx.stroke();
    }

    // Always show abbreviated label for context (unless dimmed)
    if (!hasSelection || isConnected) {
      const abbrevLabel = node.name.split('.')[0].substring(0, 6);
      const fontSize = 9 / globalScale;
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#888888';
      ctx.fillText(abbrevLabel, node.x, node.y + size + 3);
    }

    ctx.globalAlpha = 1.0; // Reset alpha
  }, [selectedNode, hoveredNode, graphData.links, connectedNodes, pulseAnimation, imagesLoaded]);

  // Draw hover/selected label after all nodes (ensures it's always on top)
  const drawLabelOnTop = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const targetNode = hoveredNode || selectedNode;
    if (!targetNode) return;

    // Find the node's current position in graphData
    const node = graphData.nodes.find(n => n.id === targetNode.id);
    if (!node || !node.x || !node.y) return;

    const fullLabel = node.focus;
    const labelFontSize = 16 / globalScale;
    const size = 40; // Base node size
    ctx.font = `${labelFontSize}px Sans-Serif`;

    // Measure text for background
    const metrics = ctx.measureText(fullLabel);
    const textWidth = metrics.width;
    const textHeight = labelFontSize;
    const padding = 8 / globalScale;

    // Draw background (positioned above the node)
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(
      node.x - textWidth / 2 - padding,
      node.y - size - 20 - textHeight - padding,
      textWidth + padding * 2,
      textHeight + padding * 2
    );

    // Draw text (positioned above the node)
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fullLabel, node.x, node.y - size - 20 - textHeight);

    ctx.globalAlpha = 1.0; // Reset alpha
  }, [hoveredNode, selectedNode, graphData.nodes]);

  if (!scenePath) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">No scene selected</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading scene graph...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-destructive">{error}</span>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="h-full w-full outline-none focus:ring-2 focus:ring-muted-foreground/30 focus:ring-inset"
        tabIndex={0}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      >
        <ResizablePanelGroup direction="vertical" className="h-full">
          {/* Graph Panel */}
          <ResizablePanel
            defaultSize={70}
            minSize={30}
            onResize={() => {
              // Force dimension update when panel resizes
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect && rect.width > 0 && rect.height > 0) {
                setDimensions({ width: rect.width, height: rect.height });
              }
            }}
          >
            <div className="h-full w-full bg-background relative">
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={drawNode}
              nodeCanvasObjectMode={() => 'replace'}
              nodeLabel={() => ''}
              nodeVal={(node: any) => {
                // Calculate node value for collision detection based on thumbnail size
                const connectionCount = graphData.links.filter(
                  (link: any) => link.source === node.id || link.target === node.id ||
                                 link.source.id === node.id || link.target.id === node.id
                ).length;
                const size = 60 + Math.min(connectionCount * 4, 40);
                return size; // Return radius directly for hit detection
              }}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onBackgroundClick={() => {
                setSelectedNode(null);
                setConnectedNodes(new Set());
              }}
              onRenderFramePost={drawLabelOnTop}
              linkLabel={(link: any) => link.description}
              linkColor={(link: any) => {
                if (!selectedNode) return '#4b5563';
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                const isConnectedLink = connectedNodes.has(sourceId) && connectedNodes.has(targetId);
                return isConnectedLink ? '#10b981' : '#2d3748';
              }}
              linkWidth={(link: any) => {
                if (!selectedNode) return 1;
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                const isConnectedLink = connectedNodes.has(sourceId) && connectedNodes.has(targetId);
                return isConnectedLink ? 2 : 0.5;
              }}
              linkDirectionalParticles={0}
              backgroundColor="#09090b"
              warmupTicks={200}
              cooldownTicks={100}
              onEngineStop={handleEngineStop}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.4}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Info Panel */}
        <ResizablePanel defaultSize={30} minSize={15} maxSize={50}>
          <div className="h-full bg-background border-t border-border overflow-auto">
            {selectedNode ? (
              <div className="p-4 flex gap-3 items-start">
                {/* Column 1: Selected node thumbnail */}
                <div
                  className="flex-shrink-0 cursor-pointer group"
                  onClick={() => handleNodeImageClick(selectedNode)}
                  title="Click to view full size"
                >
                  <img
                    src={selectedNode.imageUrl}
                    alt={selectedNode.name}
                    className="w-24 h-24 object-cover rounded border-2 border-border group-hover:border-white transition-colors"
                    loading="lazy"
                  />
                </div>

                {/* Column 2: Carousel of connected images */}
                <div className="flex-1 min-w-0">
                  {connectedNodesList.length > 0 ? (
                    <Carousel className="w-full px-8">
                      <CarouselContent className="-ml-0.5">
                        {connectedNodesList.map(node => (
                          <CarouselItem key={node.id} className="pl-0.5 basis-1/3">
                            <div
                              className="cursor-pointer group"
                              onClick={() => handleNodeClick(node)}
                              onMouseEnter={() => handleCarouselImageHover(node)}
                              onMouseLeave={() => handleCarouselImageHover(null)}
                              title={`View ${node.focus}`}
                            >
                              <img
                                src={node.imageUrl}
                                alt={node.name}
                                className="w-24 h-24 object-cover rounded border-2 border-border group-hover:border-white transition-colors"
                                loading="lazy"
                              />
                            </div>
                          </CarouselItem>
                        ))}
                      </CarouselContent>
                      <CarouselPrevious className="left-0" />
                      <CarouselNext className="right-0" />
                    </Carousel>
                  ) : (
                    <div className="flex items-center justify-center h-24">
                      <span className="text-xs text-muted-foreground">No connected images</span>
                    </div>
                  )}
                </div>

                {/* Column 3: Text info + back button */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-sm">{selectedNode.focus}</h3>
                    <button
                      onClick={() => {
                        setSelectedNode(null);
                        setConnectedNodes(new Set());
                      }}
                      className="text-muted-foreground hover:text-foreground p-2 rounded hover:bg-accent flex-shrink-0"
                      title="Back to graph view"
                    >
                      <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{selectedNode.description}</p>
                  <div className="flex gap-3 items-center">
                    <span className="text-xs text-muted-foreground">
                      {connectedNodes.size - 1} connected image{connectedNodes.size - 1 !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 h-full flex flex-col items-center justify-center text-center">
                <p className="text-sm text-muted-foreground mb-2">Click a node to view details</p>
                <p className="text-xs text-muted-foreground">
                  • Click to select • Double-click to view image • Click background to deselect
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <Dialog open={selectedImage !== null} onOpenChange={(open) => { if (!open) setSelectedImage(null); }}>
        <DialogContent
          className="p-0 overflow-hidden"
          style={{ width: dialogSize.width, height: dialogSize.height, maxWidth: '95vw', maxHeight: '95vh' }}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {selectedImage ? selectedImage.name : 'Image Viewer'}
          </DialogTitle>
          <DialogClose className="absolute -top-10 right-0 z-50 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none bg-background border border-border p-1.5">
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
          <div className="flex items-center justify-center relative w-full h-full bg-background">
            {selectedImage && (
              <>
                <img
                  src={`file://${selectedImage.path}`}
                  alt={selectedImage.name}
                  className="max-w-full max-h-full object-contain"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-4 py-2">
                  <p className="text-sm text-white/90 truncate text-center">
                    {selectedImage.name}
                  </p>
                </div>
              </>
            )}
          </div>
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-border hover:bg-primary/50 transition-colors"
            onMouseDown={handleResizeStart}
            style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
});
