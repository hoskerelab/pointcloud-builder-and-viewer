import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import type { SceneImage } from '@/src/types/scene';
import { cn } from '@/lib/utils';
import { toSafeFileUrl } from '@/lib/safeFile';

interface ImageGalleryProps {
  scenePath: string | null;
  imagesData?: SceneImage[];
  highlightedImageIndex?: number | null;
  onImageSelect?: (image: SceneImage) => void;
}

type DisplayImage = {
  index: number;
  absolutePath: string;
  name: string;
};

export function ImageGallery({
  scenePath,
  imagesData,
  highlightedImageIndex,
  onImageSelect,
}: ImageGalleryProps) {
  const [images, setImages] = useState<DisplayImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commonAspectRatio, setCommonAspectRatio] = useState<number>(16 / 9);
  const aspectRatiosRef = useRef<Map<string, number>>(new Map());
  const loadedCountRef = useRef<number>(0);

  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const normalisedImages = useMemo(() => {
    if (!imagesData) return null;
    return imagesData
      .filter((img): img is SceneImage & { absolutePath: string } => typeof img.absolutePath === 'string')
      .map((img) => ({
        index: img.index,
        absolutePath: img.absolutePath as string,
        name: img.name,
      }))
      .sort((a, b) => a.index - b.index);
  }, [imagesData]);

  useEffect(() => {
    const resetAspectTracking = () => {
      aspectRatiosRef.current.clear();
      loadedCountRef.current = 0;
      setCommonAspectRatio(16 / 9);
    };

    if (normalisedImages) {
      setImages(normalisedImages);
      setError(null);
      setLoading(false);
      resetAspectTracking();
      return;
    }

    const loadImages = async () => {
      if (!scenePath) {
        setImages([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      resetAspectTracking();

      try {
        const imagePaths = await window.electron.getSceneImages(scenePath);
        if (imagePaths) {
          const mapped = imagePaths.map((absolutePath, index) => ({
            index,
            absolutePath,
            name: absolutePath.split('/').pop() || `Image ${index + 1}`,
          }));
          setImages(mapped);
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
  }, [scenePath, normalisedImages]);

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = event.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    const roundedRatio = Math.round(aspectRatio * 100) / 100;
    const ratioKey = roundedRatio.toFixed(2);
    const currentCount = aspectRatiosRef.current.get(ratioKey) || 0;
    aspectRatiosRef.current.set(ratioKey, currentCount + 1);

    loadedCountRef.current += 1;

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

  useEffect(() => {
    if (highlightedImageIndex === null || highlightedImageIndex === undefined) return;
    const node = cardRefs.current.get(highlightedImageIndex);
    if (node) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightedImageIndex]);

  const handleImageClick = (image: DisplayImage) => {
    if (typeof onImageSelect === 'function') {
      onImageSelect({
        index: image.index,
        name: image.name,
        absolutePath: image.absolutePath,
      });
    }
  };

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
    <ScrollArea className="h-full w-full">
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((image) => {
            const imageUrl = toSafeFileUrl(image.absolutePath);
            const imageName = image.name || `Image ${image.index + 1}`;
            const isHighlighted = highlightedImageIndex === image.index;

            return (
              <Card
                key={`${image.index}-${image.absolutePath}`}
                ref={(node) => {
                  if (!node) {
                    cardRefs.current.delete(image.index);
                    return;
                  }
                  cardRefs.current.set(image.index, node);
                }}
                className={cn(
                  'overflow-hidden transition-colors py-0 px-0 p-0 cursor-pointer border-2 border-transparent hover:border-white',
                  isHighlighted && 'border-primary ring-2 ring-primary/40'
                )}
                onClick={() => handleImageClick(image)}
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
  );
}
