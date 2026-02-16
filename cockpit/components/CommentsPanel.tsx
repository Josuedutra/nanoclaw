'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorCallout } from './ErrorCallout';

interface Activity {
  id: number;
  task_id: string;
  action: string;
  from_state: string | null;
  to_state: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
}

interface CommentsPanelProps {
  taskId: string;
  activities: Activity[];
}

async function writeAction(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; error?: string; mentions?: string[] }> {
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

export function CommentsPanel({ taskId, activities }: CommentsPanelProps) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const comments = activities.filter((a) => a.action === 'COMMENT_ADDED');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = text.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const result = await writeAction('/api/write/tasks/comment', {
        taskId,
        text: trimmed,
      });
      if (result.ok) {
        setText('');
        router.refresh();
      } else {
        setError(result.error || 'Comment failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comment failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-zinc-400">
        Comments ({comments.length})
      </h3>

      {comments.length > 0 && (
        <div className="mb-3 space-y-2">
          {comments.map((c) => (
            <div
              key={c.id}
              className="rounded border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-300">{c.actor}</span>
                <span className="text-xs text-zinc-600">{c.created_at}</span>
              </div>
              {c.reason && (
                <div className="mt-1 whitespace-pre-wrap text-zinc-400">
                  {c.reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <ErrorCallout message={error} />}

      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a comment..."
          rows={3}
          maxLength={4000}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-600">
            Mention groups: @main @developer @security @revops @product
          </span>
          <button
            type="submit"
            disabled={loading || text.trim().length === 0}
            className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-40"
          >
            {loading ? 'Posting...' : 'Post Comment'}
          </button>
        </div>
      </form>
    </section>
  );
}
