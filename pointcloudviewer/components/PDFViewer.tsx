import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ScrollArea } from '@/components/ui/scroll-area';

// Configure PDF.js worker for Electron - use relative path to bundled worker
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
}

interface PDFViewerProps {
  pdfPath: string | null;
}

export function PDFViewer({ pdfPath }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [displayedPages, setDisplayedPages] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Convert file path to safe-file:// URL and memoize it
  const fileUrl = useMemo(() => {
    if (!pdfPath) return null;
    return `safe-file://${pdfPath}`;
  }, [pdfPath]);

  // Reset displayed pages when PDF changes
  useEffect(() => {
    setDisplayedPages(2);
    setError(null);
  }, [fileUrl]);

  // Setup intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && displayedPages < numPages) {
          setDisplayedPages((prev) => Math.min(prev + 2, numPages));
        }
      },
      {
        root: null,
        rootMargin: '200px',
        threshold: 0.1,
      }
    );

    observerRef.current.observe(sentinelRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [displayedPages, numPages]);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setDisplayedPages(Math.min(2, numPages));
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('Error loading PDF document:', error);
    setError('Failed to load PDF document');
  }, []);

  if (!fileUrl) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-sm text-muted-foreground">No scene selected</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-sm text-destructive">{error}</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full w-full" ref={scrollAreaRef}>
      <div className="flex flex-col items-center gap-4 p-4 bg-background">
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center p-8">
              <span className="text-sm text-muted-foreground">Loading document...</span>
            </div>
          }
        >
          {Array.from({ length: displayedPages }, (_, index) => (
            <div key={`page_${index + 1}`} className="mb-4">
              <Page
                pageNumber={index + 1}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div className="flex items-center justify-center p-8 border border-border rounded">
                    <span className="text-sm text-muted-foreground">Loading page {index + 1}...</span>
                  </div>
                }
                className="border border-border rounded shadow-sm"
              />
              <div className="text-center text-xs text-muted-foreground mt-2">
                Page {index + 1} of {numPages}
              </div>
            </div>
          ))}
        </Document>
        {displayedPages < numPages && (
          <div ref={sentinelRef} className="h-4 w-full flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Loading more pages...</span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
