'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorCallout } from './ErrorCallout';

interface TaskActionsProps {
  taskId: string;
  state: string;
  gate: string;
  version: number;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  INBOX: ['TRIAGED', 'BLOCKED'],
  TRIAGED: ['READY', 'BLOCKED'],
  READY: ['DOING', 'BLOCKED'],
  DOING: ['REVIEW', 'BLOCKED'],
  REVIEW: ['APPROVAL', 'DOING', 'BLOCKED'],
  APPROVAL: ['DONE', 'REVIEW', 'BLOCKED'],
  BLOCKED: ['INBOX', 'TRIAGED', 'READY', 'DOING'],
};

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

export function TaskActions({ taskId, state, gate, version }: TaskActionsProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Review summary (DOING -> REVIEW)
  const [showReviewSummary, setShowReviewSummary] = useState(false);
  const [reviewSummary, setReviewSummary] = useState('');

  // Override form state
  const [showOverride, setShowOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [acceptedRisk, setAcceptedRisk] = useState('');
  const [deadline, setDeadline] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const nextStates = VALID_TRANSITIONS[state] || [];
  const canApprove = state === 'APPROVAL' && gate !== 'None';
  const canOverride = state === 'REVIEW' || state === 'APPROVAL';
  const isTerminal = state === 'DONE';

  if (isTerminal && !canApprove && !canOverride) return null;

  async function handleTransition(toState: string) {
    // Intercept DOING -> REVIEW: require review summary
    if (state === 'DOING' && toState === 'REVIEW') {
      setShowReviewSummary(true);
      return;
    }
    await doTransition(toState);
  }

  async function doTransition(toState: string, summary?: string) {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        taskId,
        toState,
        expectedVersion: version,
      };
      if (summary) body.reason = summary;

      const result = await writeAction('/api/write/tasks/transition', body);
      if (result.ok) {
        setSuccess(`Transitioned to ${toState}`);
        setShowReviewSummary(false);
        setReviewSummary('');
        router.refresh();
      } else {
        setError(result.error || 'Transition failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitReview() {
    if (!reviewSummary.trim()) {
      setError('Review summary is required for DOING -> REVIEW');
      return;
    }
    await doTransition('REVIEW', reviewSummary.trim());
  }

  async function handleApprove() {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const result = await writeAction('/api/write/tasks/approve', {
        taskId,
        gate_type: gate,
      });
      if (result.ok) {
        setSuccess(`Gate ${gate} approved`);
        router.refresh();
      } else {
        setError(result.error || 'Approval failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleOverride() {
    if (!confirmed) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const result = await writeAction('/api/write/tasks/override', {
        taskId,
        reason,
        acceptedRisk,
        reviewDeadlineIso: deadline,
      });
      if (result.ok) {
        setSuccess('Override applied - task moved to DONE');
        setShowOverride(false);
        router.refresh();
      } else {
        setError(result.error || 'Override failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-400">Actions</h3>

      {error && <ErrorCallout message={error} />}
      {success && (
        <div className="rounded border border-green-800 bg-green-900/20 px-3 py-2 text-sm text-green-400">
          {success}
        </div>
      )}

      {/* Review summary modal (DOING -> REVIEW) */}
      {showReviewSummary && (
        <div className="space-y-2 rounded border border-purple-800 bg-purple-900/10 p-4">
          <div className="text-sm font-medium text-purple-300">
            Review Summary Required
          </div>
          <p className="text-xs text-zinc-400">
            Describe what was done and what should be reviewed.
          </p>
          <textarea
            value={reviewSummary}
            onChange={(e) => setReviewSummary(e.target.value)}
            placeholder="What was implemented, tested, or changed?"
            rows={3}
            maxLength={4000}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmitReview}
              disabled={loading || !reviewSummary.trim()}
              className="rounded bg-purple-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'Submit for Review'}
            </button>
            <button
              onClick={() => {
                setShowReviewSummary(false);
                setReviewSummary('');
              }}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Transition buttons */}
      {nextStates.length > 0 && !showReviewSummary && (
        <div className="flex flex-wrap gap-2">
          {nextStates.map((s) => (
            <button
              key={s}
              onClick={() => handleTransition(s)}
              disabled={loading}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700 disabled:opacity-50"
            >
              &rarr; {s}
            </button>
          ))}
        </div>
      )}

      {/* Approve gate button */}
      {canApprove && (
        <button
          onClick={handleApprove}
          disabled={loading}
          className="rounded bg-green-800 px-4 py-1.5 text-sm font-medium text-green-100 hover:bg-green-700 disabled:opacity-50"
        >
          Approve Gate: {gate}
        </button>
      )}

      {/* Founder override */}
      {canOverride && (
        <div>
          {!showOverride ? (
            <button
              onClick={() => setShowOverride(true)}
              className="rounded border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
            >
              Founder Override
            </button>
          ) : (
            <div className="space-y-3 rounded border border-red-800 bg-red-900/10 p-4">
              <div className="text-sm font-medium text-red-400">
                Founder Override — Skip to DONE
              </div>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (required)"
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
              />
              <input
                type="text"
                value={acceptedRisk}
                onChange={(e) => setAcceptedRisk(e.target.value)}
                placeholder="Accepted risk (required)"
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
              />
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              />
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I understand this bypasses gate approval
              </label>
              <div className="flex gap-2">
                <button
                  onClick={handleOverride}
                  disabled={
                    loading || !confirmed || !reason || !acceptedRisk || !deadline
                  }
                  className="rounded bg-red-800 px-4 py-1.5 text-sm font-medium text-red-100 hover:bg-red-700 disabled:opacity-50"
                >
                  Apply Override
                </button>
                <button
                  onClick={() => setShowOverride(false)}
                  className="rounded border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
