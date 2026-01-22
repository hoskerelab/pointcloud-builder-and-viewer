import React, { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { RtspPanel } from "@/components/RtspPanel";
import { Button } from "@/components/ui/button";

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function RtspFloatingWidget() {
  const [rect, setRect] = useState<Rect>({ x: 24, y: 24, w: 420, h: 260 });
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const rectRef = useRef(rect);
  const savedRectRef = useRef<Rect | null>(null);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    setRect((prev) => {
      const x = Math.max(24, window.innerWidth - prev.w - 24);
      const y = Math.max(24, Math.min(prev.y, window.innerHeight - prev.h - 24));
      return { ...prev, x, y };
    });
  }, []);

  useEffect(() => {
    if (!dragging && !resizing) return;

    const onMove = (event: MouseEvent) => {
      if (dragRef.current) {
        const { startX, startY, originX, originY } = dragRef.current;
        const nextX = originX + (event.clientX - startX);
        const nextY = originY + (event.clientY - startY);
        const maxX = Math.max(0, window.innerWidth - rectRef.current.w);
        const maxY = Math.max(0, window.innerHeight - rectRef.current.h);
        setRect((prev) => ({
          ...prev,
          x: clamp(nextX, 0, maxX),
          y: clamp(nextY, 0, maxY),
        }));
      }

      if (resizeRef.current) {
        const { startX, startY, originW, originH } = resizeRef.current;
        const nextW = originW + (event.clientX - startX);
        const nextH = originH + (event.clientY - startY);
        const maxW = Math.max(240, window.innerWidth - rectRef.current.x);
        const maxH = Math.max(160, window.innerHeight - rectRef.current.y);
        setRect((prev) => ({
          ...prev,
          w: clamp(nextW, 240, maxW),
          h: clamp(nextH, 160, maxH),
        }));
      }
    };

    const onUp = () => {
      setDragging(false);
      setResizing(false);
      dragRef.current = null;
      resizeRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, resizing]);

  useEffect(() => {
    const onResize = () => {
      setRect((prev) => {
        if (maximized) {
          return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
        }
        const maxX = Math.max(0, window.innerWidth - prev.w);
        const maxY = Math.max(0, window.innerHeight - prev.h);
        return {
          ...prev,
          x: clamp(prev.x, 0, maxX),
          y: clamp(prev.y, 0, maxY),
        };
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maximized]);

  const startDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || maximized) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rectRef.current.x,
      originY: rectRef.current.y,
    };
    setDragging(true);
  };

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || maximized) return;
    event.stopPropagation();
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originW: rectRef.current.w,
      originH: rectRef.current.h,
    };
    setResizing(true);
  };

  const toggleMaximize = () => {
    if (!maximized) {
      savedRectRef.current = rectRef.current;
      setRect({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      setMaximized(true);
      return;
    }

    const saved = savedRectRef.current ?? { x: 24, y: 24, w: 420, h: 260 };
    setRect(saved);
    setMaximized(false);
  };

  return (
    <div
      className="fixed z-50"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-background/90 shadow-xl backdrop-blur">
        <div
          className={`flex items-center justify-between border-b border-border px-2 py-1 ${
            maximized ? "cursor-default" : "cursor-move"
          }`}
          onMouseDown={startDrag}
        >
          <div className="text-xs text-muted-foreground">Live Stream</div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleMaximize} aria-label="Toggle maximize">
              {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="relative flex-1">
          <RtspPanel />
        </div>
        {!maximized && (
          <div
            className="absolute bottom-2 right-2 h-4 w-4 cursor-se-resize rounded-sm border border-border/60 bg-background/80"
            onMouseDown={startResize}
            title="Resize"
          />
        )}
      </div>
    </div>
  );
}
