import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SceneImage } from '@/src/types/scene';
import { cn } from '@/lib/utils';
import { toSafeFileUrl } from '@/lib/safeFile';
import { X } from 'lucide-react';

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

type GalleryTab = {
  id: string;
  label: string;
  images: DisplayImage[];
  status?: 'pending' | 'ready' | 'error';
  error?: string;
};

const getDisplayName = (absolutePath: string) => {
  const fileName = absolutePath.split(/[/\\]/).pop() || absolutePath;
  const lowerName = fileName.toLowerCase();
  if (lowerName.includes('overlay') || lowerName.includes('mask')) {
    const parent = absolutePath.split(/[/\\]/).slice(-2, -1)[0];
    return parent || fileName;
  }
  return fileName;
};

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

type GalleryImageCardProps = {
  image: DisplayImage;
  scenePath: string | null;
  commonAspectRatio: number;
  isHighlighted: boolean;
  onClick: () => void;
  onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
};

function GalleryImageCard({
  image,
  scenePath,
  commonAspectRatio,
  isHighlighted,
  onClick,
  onLoad,
}: GalleryImageCardProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadThumb = async () => {
      if (!scenePath) return;
      const response = await window.electron?.getThumbnail?.(image.absolutePath, scenePath, 512);
      if (!cancelled && response?.ok && response.thumbnailPath) {
        setThumbUrl(toSafeFileUrl(response.thumbnailPath));
      }
    };
    void loadThumb();
    return () => {
      cancelled = true;
    };
  }, [image.absolutePath, scenePath]);

  return (
    <Card
      key={`${image.index}-${image.absolutePath}`}
      className={cn(
        'overflow-hidden transition-colors py-0 px-0 p-0 cursor-pointer border-2 border-transparent hover:border-white',
        isHighlighted && 'border-primary ring-2 ring-primary/40'
      )}
      onClick={onClick}
    >
      <CardContent className="py-0 px-0">
        <AspectRatio ratio={commonAspectRatio}>
          <img
            src={thumbUrl ?? TRANSPARENT_PIXEL}
            alt={image.name}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onLoad={onLoad}
          />
        </AspectRatio>
        <div className="p-2">
          <p className="text-xs text-muted-foreground truncate" title={image.name}>
            {image.name}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ImageGallery({
  scenePath,
  imagesData,
  highlightedImageIndex,
  onImageSelect,
}: ImageGalleryProps) {
  const [images, setImages] = useState<DisplayImage[]>([]);
  const [segmentedTabs, setSegmentedTabs] = useState<GalleryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('base');
  const [promptInput, setPromptInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commonAspectRatio, setCommonAspectRatio] = useState<number>(16 / 9);
  const aspectRatiosRef = useRef<Map<string, number>>(new Map());
  const loadedCountRef = useRef<number>(0);
  const pollRef = useRef<number | null>(null);

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
      setActiveTabId('base');
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
            name: getDisplayName(absolutePath) || `Image ${index + 1}`,
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

  const refreshSegmentations = async () => {
    if (!scenePath) {
      setSegmentedTabs([]);
      return;
    }
    try {
      const activeLabel = segmentedTabs.find((tab) => tab.id === activeTabId)?.label ?? null;
      const response = await window.electron?.listSegmentations?.(scenePath);
      if (!response?.ok) return;
      const responseTabs = response.tabs ?? [];
      setSegmentedTabs((prev) => {
        const prevByLabel = new Map(prev.map((tab) => [tab.label, tab]));
        const nextTabs = responseTabs.map((tab, index) => {
          const prevTab = prevByLabel.get(tab.label);
          const images = tab.images.map((absolutePath, imageIndex) => ({
            index: imageIndex,
            absolutePath,
            name: getDisplayName(absolutePath) || `Segment ${imageIndex + 1}`,
          }));
          const status = prevTab?.status === 'pending' ? 'pending' : 'ready';
          return {
            id: prevTab?.id ?? `seg-existing-${tab.label}-${index}`,
            label: tab.label,
            images,
            status,
          };
        });
        const existingLabels = new Set(nextTabs.map((tab) => tab.label));
        const pending = prev.filter(
          (tab) =>
            (tab.status === 'pending' || tab.status === 'error') && !existingLabels.has(tab.label)
        );
        return [...nextTabs, ...pending];
      });
      const nextIds = new Set(
        responseTabs.map((tab, index) => `seg-existing-${tab.label}-${index}`)
      );
      const hasActive =
        activeTabId === 'base' ||
        segmentedTabs.some((tab) => tab.id === activeTabId) ||
        nextIds.has(activeTabId);
      if (!hasActive) {
        setActiveTabId('base');
      }
    } catch (error) {
      console.error('Failed to load segmentation tabs:', error);
    }
  };

  useEffect(() => {
    void refreshSegmentations();
  }, [scenePath]);

  useEffect(() => {
    if (activeTabId !== 'base') return;
    setActiveTabId('base');
  }, [images]);

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

  const handleSubmitPrompt = async () => {
    const prompt = promptInput.trim();
    if (!prompt) return;
    const existing = segmentedTabs.find((tab) => tab.label === prompt);
    if (existing) {
      setActiveTabId(existing.id);
      setPromptInput('');
      return;
    }
    const tabId = `seg-${prompt}-${Date.now()}`;
    setSegmentedTabs((prev) => [
      ...prev,
      {
        id: tabId,
        label: prompt,
        images: [],
        status: 'pending',
      },
    ]);
    setActiveTabId(tabId);
    setPromptInput('');
    try {
      const response = await window.electron?.runSegmentation?.(prompt, scenePath ?? null);
      if (response?.ok) {
        const nextImages = (response.images ?? []).map((absolutePath, index) => ({
          index,
          absolutePath,
          name: getDisplayName(absolutePath) || `Segment ${index + 1}`,
        }));
        setSegmentedTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId ? { ...tab, images: nextImages, status: 'ready' } : tab
          )
        );
        void refreshSegmentations();
      } else {
        setSegmentedTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? { ...tab, status: 'error', error: response?.error || 'Segmentation failed' }
              : tab
          )
        );
      }
    } catch (error) {
      setSegmentedTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                status: 'error',
                error: error instanceof Error ? error.message : 'Segmentation failed',
              }
            : tab
        )
      );
    }
  };

  const handleDeleteTab = async (label: string) => {
    if (!scenePath) return;
    const confirmed = window.confirm(`Delete segmentation "${label}"? This will remove its folder.`);
    if (!confirmed) return;
    setSegmentedTabs((prev) => prev.filter((tab) => tab.label !== label));
    if (activeTabId !== 'base' && segmentedTabs.find((tab) => tab.label === label)) {
      setActiveTabId('base');
    }
    const response = await window.electron?.deleteSegmentation?.(scenePath, label);
    if (response?.ok) {
      await refreshSegmentations();
    }
  };

  const tabs: GalleryTab[] = [
    { id: 'base', label: 'Base', images, status: 'ready' },
    ...segmentedTabs,
  ];

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeImages = activeTab?.images ?? [];

  useEffect(() => {
    const hasPending = segmentedTabs.some((tab) => tab.status === 'pending');
    if (hasPending && pollRef.current === null) {
      pollRef.current = window.setInterval(() => {
        void refreshSegmentations();
      }, 1000);
    }
    if (!hasPending && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [segmentedTabs]);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
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
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-border px-3 py-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((tab) => (
              <div key={tab.id} className="flex items-center gap-1">
                <Button
                  variant={tab.id === activeTabId ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTabId(tab.id)}
                  className="h-7 px-2 text-xs"
                >
                  {tab.label}
                </Button>
                {tab.id !== 'base' && (
                  <button
                    type="button"
                    className="h-5 w-5 rounded text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteTab(tab.label);
                    }}
                    aria-label={`Delete ${tab.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="Prompt..."
              className="h-7 w-40 text-xs"
            />
            <Button
              onClick={handleSubmitPrompt}
              disabled={!promptInput.trim()}
              size="sm"
              className="h-7 px-2 text-xs"
            >
              Segment
            </Button>
          </div>
        </div>
      </div>
      <ScrollArea className="h-full w-full">
        {activeTab?.id !== 'base' && activeImages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            {activeTab.status === 'pending'
              ? `Running segmentation for "${activeTab.label}"...`
              : activeTab.status === 'error'
              ? activeTab.error || `Failed to segment "${activeTab.label}".`
              : `Segmented results for "${activeTab.label}" will appear here.`}
          </div>
        ) : (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeImages.map((image) => {
              const isHighlighted = highlightedImageIndex === image.index && activeTab?.id === 'base';
              return (
                <div
                  key={`${image.index}-${image.absolutePath}`}
                  ref={(node) => {
                    if (!node) {
                      cardRefs.current.delete(image.index);
                      return;
                    }
                    cardRefs.current.set(image.index, node);
                  }}
                >
                  <GalleryImageCard
                    image={image}
                    scenePath={scenePath}
                    commonAspectRatio={commonAspectRatio}
                    isHighlighted={isHighlighted}
                    onClick={() => handleImageClick(image)}
                    onLoad={(event) => {
                      if (activeTab?.id === 'base') {
                        handleImageLoad(event);
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
