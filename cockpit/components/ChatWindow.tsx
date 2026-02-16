'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSse, type SseEvent } from '@/lib/use-sse';
import { ErrorCallout } from './ErrorCallout';

interface Message {
  id: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_bot_message: boolean;
}

interface ChatWindowProps {
  initialMessages: Message[];
}

async function writeAction(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; error?: string }> {
  const csrf = sessionStorage.getItem('csrf') || '';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function ChatWindow({ initialMessages }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);

  // Keep ref in sync for SSE callback
  messagesRef.current = messages;

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages every 5s
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/ops/messages?limit=100');
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
        }
      } catch { /* ignore poll errors */ }
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  // SSE for real-time bot responses
  const handleSseEvent = useCallback((event: SseEvent) => {
    if (event.type === 'chat:message' && event.data.text) {
      const sseMsg: Message = {
        id: `sse-${Date.now()}`,
        sender_name: (event.data.sender as string) || 'Agent',
        content: event.data.text as string,
        timestamp: event.data.timestamp as string || new Date().toISOString(),
        is_bot_message: true,
      };
      // Append if not already present (dedup by content+timestamp)
      setMessages((prev) => {
        const exists = prev.some(
          (m) => m.content === sseMsg.content && m.timestamp === sseMsg.timestamp,
        );
        return exists ? prev : [...prev, sseMsg];
      });
    }
  }, []);

  useSse(handleSseEvent);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const text = input.trim();
    setInput('');
    setError('');
    setSending(true);

    // Optimistic: add user message immediately
    const optimisticMsg: Message = {
      id: `local-${Date.now()}`,
      sender_name: 'Owner',
      content: text,
      timestamp: new Date().toISOString(),
      is_bot_message: false,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const result = await writeAction('/api/write/chat/send', { message: text });
      if (!result.ok) {
        setError(result.error || 'Failed to send message');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-500 py-8">
            No messages yet. Send a message to start chatting.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.is_bot_message ? 'justify-start' : 'justify-end'}`}
          >
            <div
              className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                msg.is_bot_message
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'bg-blue-700/20 text-blue-100 border border-blue-700/30'
              }`}
            >
              <div className="mb-1 text-xs text-zinc-500">
                {msg.sender_name}
                <span className="ml-2">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4">
          <ErrorCallout message={error} />
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="border-t border-zinc-800 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            maxLength={4000}
            disabled={sending}
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
