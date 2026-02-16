'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface MarkAllReadButtonProps {
  ids: number[];
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

export function MarkAllReadButton({ ids }: MarkAllReadButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await writeAction('/api/write/notifications/markRead', { ids });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-40"
    >
      {loading ? 'Marking...' : 'Mark all read'}
    </button>
  );
}
