import React, { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface QAPairsViewerProps {
  qaPairsPath: string | null;
}

interface QAPair {
  question: string;
  answer: string;
  reference_images: string[];
  condition_rating: {
    score: number;
  } | null;
}

export function QAPairsViewer({ qaPairsPath }: QAPairsViewerProps) {
  const [qaPairs, setQaPairs] = useState<QAPair[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadQAPairs = async () => {
      if (!qaPairsPath) {
        setQaPairs([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await window.electron.readQAPairs(qaPairsPath);
        if (data) {
          setQaPairs(data);
        } else {
          setError('Failed to load Q&A pairs');
        }
      } catch (err) {
        console.error('Error loading Q&A pairs:', err);
        setError('Failed to load Q&A pairs');
      } finally {
        setLoading(false);
      }
    };

    loadQAPairs();
  }, [qaPairsPath]);

  if (!qaPairsPath) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-sm text-muted-foreground">No scene selected</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-sm text-muted-foreground">Loading Q&A pairs...</span>
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

  if (qaPairs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-sm text-muted-foreground">No Q&A pairs found</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-4 space-y-4">
        {qaPairs.map((qa, index) => (
          <Card key={index} className="hover:bg-accent/50 transition-colors">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium leading-snug">
                {qa.question}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {qa.answer}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {qa.condition_rating && (
                  <Badge variant="secondary" className="text-xs">
                    Rating: {qa.condition_rating.score}
                  </Badge>
                )}
                {qa.reference_images && qa.reference_images.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {qa.reference_images.length} {qa.reference_images.length === 1 ? 'image' : 'images'}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
