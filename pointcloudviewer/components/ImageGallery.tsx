import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import {
  Dialog,
  DialogContent,
  DialogClose,
} from '@/components/ui/dialog';
import { XIcon } from 'lucide-react';

interface ImageGalleryProps {
  scenePath: string | null;
}

export function ImageGallery({ scenePath }: ImageGalleryProps) {
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commonAspectRatio, setCommonAspectRatio] = useState<number>(16 / 9);
  const aspectRatiosRef = useRef<Map<string, number>>(new Map());
  const loadedCountRef = useRef<number>(0);
  const [selectedImage, setSelectedImage] = useState<{ path: string; name: string } | null>(null);
  const [dialogSize, setDialogSize] = useState({ width: 800, height: 600 });
  const resizeRef = useRef<{ isResizing: boolean; startX: number; startY: number; startWidth: number; startHeight: number }>({
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
  });

  useEffect(() => {
    const loadImages = async () => {
      if (!scenePath) {
        setImages([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      // Reset aspect ratio tracking
      aspectRatiosRef.current.clear();
      loadedCountRef.current = 0;
      setCommonAspectRatio(16 / 9); // Reset to default

      try {
        const imagePaths = await window.electron.getSceneImages(scenePath);
        if (imagePaths) {
          setImages(imagePaths);
        } else {
          setError('Failed to load images');
        }
      } catch (err) {
        console.error('Error loading images:', err);
        setError('Failed to load images');
      } finally {
        setLoading(false);
      }
    };

    loadImages();
  }, [scenePath]);

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = event.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;

    // Round to nearest common aspect ratio for grouping
    const roundedRatio = Math.round(aspectRatio * 100) / 100;

    // Track this aspect ratio
    const ratioKey = roundedRatio.toFixed(2);
    const currentCount = aspectRatiosRef.current.get(ratioKey) || 0;
    aspectRatiosRef.current.set(ratioKey, currentCount + 1);

    loadedCountRef.current += 1;

    // Once we've loaded at least half the images, calculate most common ratio
    if (loadedCountRef.current >= Math.ceil(images.length / 2)) {
      let maxCount = 0;
      let mostCommonRatio = 16 / 9;

      aspectRatiosRef.current.forEach((count, ratioStr) => {
        if (count > maxCount) {
          maxCount = count;
          mostCommonRatio = parseFloat(ratioStr);
        }
      });

      setCommonAspectRatio(mostCommonRatio);
    }
  };

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

  if (!scenePath) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">No scene selected</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading images...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-destructive">{error}</span>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">No images found</span>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full w-full">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((imagePath, index) => {
            const imageUrl = `file://${imagePath}`;
            const imageName = imagePath.split('/').pop() || `Image ${index + 1}`;

            return (
              <Card
                key={index}
                className="overflow-hidden transition-colors py-0 px-0 p-0 cursor-pointer border-2 border-transparent hover:border-white"
                onClick={() => setSelectedImage({ path: imagePath, name: imageName })}
              >
                <CardContent className="py-0 px-0">
                  <AspectRatio ratio={commonAspectRatio}>
                    <img
                      src={imageUrl}
                      alt={imageName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onLoad={handleImageLoad}
                    />
                  </AspectRatio>
                  <div className="p-2">
                    <p className="text-xs text-muted-foreground truncate" title={imageName}>
                      {imageName}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      <Dialog open={selectedImage !== null} onOpenChange={(open) => { if (!open) setSelectedImage(null); }}>
        <DialogContent
          className="p-0 overflow-hidden"
          style={{ width: dialogSize.width, height: dialogSize.height, maxWidth: '95vw', maxHeight: '95vh' }}
          showCloseButton={false}
        >
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
}
