import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Loader2, AlertCircle } from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  error?: string;
}

export interface ViewerCommand {
  type: 'glb' | 'sceneGraph' | 'camera' | 'highlight';
  action: string;
  params?: Record<string, unknown>;
}

interface ChatInterfaceProps {
  onCommand?: (command: ViewerCommand) => void;
  apiEndpoint?: string;
}

export function ChatInterface({ onCommand, apiEndpoint = 'http://localhost:8000' }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [backendEnabled, setBackendEnabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages]);

  const handleSendMessage = useCallback(async () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue || isLoading) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Send to FastAPI backend
      const response = await window.electron.sendChatMessage(trimmedValue);

      // Handle response
      if (response.error) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: response.error,
          timestamp: new Date(),
          error: response.error,
        };
        setMessages(prev => [...prev, errorMessage]);
      } else {
        // Add assistant response
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.message || response.content || 'No response',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Check for viewer commands in response
        if (response.command && onCommand) {
          onCommand(response.command as ViewerCommand);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Failed to connect to the backend. Make sure the FastAPI server is running.',
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, onCommand]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  const formatTimestamp = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="flex flex-col h-full bg-background outline-none focus:ring-2 focus:ring-muted-foreground/30 focus:ring-inset"
      tabIndex={0}
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Bridge Inspector Assistant</h2>
        <p className="text-xs text-muted-foreground">
          {backendEnabled ? 'Ask questions or control viewers' : 'Backend not connected'}
        </p>
      </div>

      {/* Messages Area */}
      <ScrollArea ref={scrollRef} className="flex-1 px-4 py-4">
        <div className="space-y-4">
          {messages.map(message => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              {/* Avatar */}
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarFallback
                  className={
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.role === 'system'
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  }
                >
                  {message.role === 'user' ? 'U' : message.role === 'system' ? 'S' : 'AI'}
                </AvatarFallback>
              </Avatar>

              {/* Message Content */}
              <div
                className={`flex flex-col gap-1 max-w-[80%] ${
                  message.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <Card
                  className={`px-4 py-2 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.error
                      ? 'bg-destructive/10 border-destructive/50'
                      : message.role === 'system'
                      ? 'bg-muted'
                      : 'bg-secondary'
                  }`}
                >
                  {message.error && (
                    <div className="flex items-center gap-2 mb-2 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-xs font-semibold">Error</span>
                    </div>
                  )}
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                </Card>
                <span className="text-xs text-muted-foreground px-1">
                  {formatTimestamp(message.timestamp)}
                </span>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarFallback className="bg-secondary text-secondary-foreground">
                  AI
                </AvatarFallback>
              </Avatar>
              <Card className="px-4 py-2 bg-secondary">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </Card>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or give a command..."
            className="resize-none min-h-[60px] max-h-[120px]"
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!backendEnabled || !inputValue.trim() || isLoading}
            size="icon"
            className="flex-shrink-0 h-[60px] w-[60px]"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {backendEnabled
            ? 'Press Enter to send, Shift+Enter for new line'
            : 'Backend not connected. Set up FastAPI server to enable chat.'}
        </p>
      </div>
    </div>
  );
}
