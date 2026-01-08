import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { AspectRatio } from '@/components/ui/aspect-ratio';

interface UploadedImagesViewerProps {
  imageUrls: string[];
}

export function UploadedImagesViewer({ imageUrls }: UploadedImagesViewerProps) {
  console.log('UploadedImagesViewer received imageUrls:', imageUrls.length, imageUrls);
  
  if (imageUrls.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-red-100 border-2 border-red-500">
        <span className="text-red-600 text-sm font-bold">No uploaded images (debug)</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b">
        <h3 className="text-sm font-medium">Uploaded Images ({imageUrls.length})</h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 grid grid-cols-2 gap-2">
          {imageUrls.map((url, index) => (
            <Card key={index} className="overflow-hidden">
              <CardContent className="p-2">
                <AspectRatio ratio={16 / 9}>
                  <img
                    src={url}
                    alt={`Uploaded ${index + 1}`}
                    className="w-full h-full object-cover rounded"
                    loading="lazy"
                  />
                </AspectRatio>
                <div className="mt-1 text-xs text-muted-foreground truncate">
                  Image {index + 1}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}