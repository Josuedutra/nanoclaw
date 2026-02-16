'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorCallout } from './ErrorCallout';
import { EvidenceBulkForm } from './EvidenceBulkForm';

interface EvidenceEntry {
  link: string;
  note: string;
  addedAt: string;
}

interface EvidencePanelProps {
  taskId: string;
  initialEvidence: EvidenceEntry[];
  docsUpdated: boolean;
  taskType: string;
}

const DOCS_REQUIRED_TYPES = ['SECURITY', 'REVOPS', 'INCIDENT', 'FEATURE'];

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

export function EvidencePanel({
  taskId,
  initialEvidence,
  docsUpdated,
  taskType,
}: EvidencePanelProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Add evidence form
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');

  // Docs toggle
  const [docsFlag, setDocsFlag] = useState(docsUpdated);
  const [docsSaving, setDocsSaving] = useState(false);

  const showDocsToggle = DOCS_REQUIRED_TYPES.includes(taskType);

  async function handleAddEvidence(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await writeAction('/api/write/tasks/evidence', {
        taskId,
        link,
        note: note || undefined,
      });
      if (result.ok) {
        setLink('');
        setNote('');
        router.refresh();
      } else {
        setError(result.error || 'Failed to add evidence');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleDocsToggle() {
    setError('');
    setDocsSaving(true);
    const newValue = !docsFlag;
    try {
      const result = await writeAction('/api/write/tasks/docsUpdated', {
        taskId,
        docsUpdated: newValue,
      });
      if (result.ok) {
        setDocsFlag(newValue);
        router.refresh();
      } else {
        setError(result.error || 'Failed to update docs flag');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setDocsSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-400">Evidence &amp; Docs</h3>

      {error && <ErrorCallout message={error} />}

      {/* Existing evidence */}
      {initialEvidence.length > 0 && (
        <div className="space-y-1 rounded border border-zinc-800 bg-zinc-950 p-3 text-sm">
          {initialEvidence.map((ev, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-blue-400">&#128279;</span>
              <div>
                <a
                  href={ev.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline hover:text-blue-300"
                >
                  {ev.link.length > 80 ? ev.link.slice(0, 80) + '...' : ev.link}
                </a>
                {ev.note && (
                  <span className="ml-2 text-zinc-500"> — {ev.note}</span>
                )}
                <span className="ml-2 text-xs text-zinc-600">{ev.addedAt}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add evidence form */}
      <form onSubmit={handleAddEvidence} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Evidence link (URL)"
            required
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            maxLength={1000}
            className="w-48 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !link}
            className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? '...' : 'Add'}
          </button>
        </div>
      </form>

      {/* Bulk add evidence */}
      <EvidenceBulkForm taskId={taskId} />

      {/* Docs updated toggle */}
      {showDocsToggle && (
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <button
            type="button"
            onClick={handleDocsToggle}
            disabled={docsSaving}
            className="text-base leading-none disabled:opacity-50"
            aria-label={docsFlag ? 'Unmark docs updated' : 'Mark docs updated'}
          >
            {docsFlag ? (
              <span className="text-green-500">&#9745;</span>
            ) : (
              <span className="text-zinc-600">&#9744;</span>
            )}
          </button>
          Documentation updated
          {docsSaving && <span className="text-xs text-zinc-600">(saving...)</span>}
        </label>
      )}
    </section>
  );
}
