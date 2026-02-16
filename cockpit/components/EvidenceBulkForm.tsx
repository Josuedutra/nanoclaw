'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorCallout } from './ErrorCallout';

interface LineError {
  line: number;
  message: string;
}

interface EvidenceBulkFormProps {
  taskId: string;
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

function validateLines(text: string): { valid: string[]; errors: LineError[] } {
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const errors: LineError[] = [];
  const valid: string[] = [];

  if (rawLines.length > 20) {
    errors.push({ line: 0, message: 'Maximum 20 links per bulk submission' });
    return { valid: [], errors };
  }

  rawLines.forEach((line, i) => {
    if (line.length > 2000) {
      errors.push({ line: i + 1, message: `Line ${i + 1}: URL exceeds 2000 characters` });
    } else {
      try {
        const url = new URL(line);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push({ line: i + 1, message: `Line ${i + 1}: must be http or https URL` });
        } else {
          valid.push(line);
        }
      } catch {
        errors.push({ line: i + 1, message: `Line ${i + 1}: invalid URL` });
      }
    }
  });

  return { valid, errors };
}

export function EvidenceBulkForm({ taskId }: EvidenceBulkFormProps) {
  const router = useRouter();
  const [linksText, setLinksText] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lineErrors, setLineErrors] = useState<LineError[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLineErrors([]);

    const { valid, errors } = validateLines(linksText);
    if (errors.length > 0) {
      setLineErrors(errors);
      return;
    }
    if (valid.length === 0) return;

    setLoading(true);
    try {
      const result = await writeAction('/api/write/tasks/evidence/bulk', {
        taskId,
        links: valid,
        note: note || undefined,
      });
      if (result.ok) {
        setLinksText('');
        setNote('');
        router.refresh();
      } else {
        setError(result.error || 'Bulk add failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk add failed');
    } finally {
      setLoading(false);
    }
  }

  const lineCount = linksText.split('\n').map((l) => l.trim()).filter(Boolean).length;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="text-xs font-medium text-zinc-500">Bulk Add Links</div>

      {error && <ErrorCallout message={error} />}

      {lineErrors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-400">
          {lineErrors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}

      <textarea
        value={linksText}
        onChange={(e) => setLinksText(e.target.value)}
        placeholder="Paste URLs, one per line (max 20)"
        rows={4}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
      />

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Shared note (optional, max 1000 chars)"
        maxLength={1000}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
      />

      <button
        type="submit"
        disabled={loading || lineCount === 0}
        className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-40"
      >
        {loading ? 'Adding...' : `Bulk Add${lineCount > 0 ? ` (${lineCount})` : ''}`}
      </button>
    </form>
  );
}
