import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommentsPanel } from './CommentsPanel';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ACTIVITIES = [
  {
    id: 1,
    task_id: 'gov-1',
    action: 'COMMENT_ADDED',
    from_state: 'INBOX',
    to_state: null,
    actor: 'cockpit',
    reason: 'First comment',
    created_at: '2026-02-16T10:00:00Z',
  },
  {
    id: 2,
    task_id: 'gov-1',
    action: 'transition',
    from_state: 'INBOX',
    to_state: 'TRIAGED',
    actor: 'main',
    reason: null,
    created_at: '2026-02-16T10:01:00Z',
  },
  {
    id: 3,
    task_id: 'gov-1',
    action: 'COMMENT_ADDED',
    from_state: 'TRIAGED',
    to_state: null,
    actor: 'developer',
    reason: 'Second comment @security please review',
    created_at: '2026-02-16T10:02:00Z',
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('CommentsPanel', () => {
  it('renders only COMMENT_ADDED activities', () => {
    render(<CommentsPanel taskId="gov-1" activities={ACTIVITIES} />);
    expect(screen.getByText('Comments (2)')).toBeTruthy();
    expect(screen.getByText('First comment')).toBeTruthy();
    expect(screen.getByText(/Second comment/)).toBeTruthy();
  });

  it('shows actor and timestamp for each comment', () => {
    render(<CommentsPanel taskId="gov-1" activities={ACTIVITIES} />);
    expect(screen.getByText('cockpit')).toBeTruthy();
    expect(screen.getByText('developer')).toBeTruthy();
    expect(screen.getByText('2026-02-16T10:00:00Z')).toBeTruthy();
  });

  it('shows mention hint text', () => {
    render(<CommentsPanel taskId="gov-1" activities={[]} />);
    expect(screen.getByText(/Mention groups/)).toBeTruthy();
    expect(screen.getByText(/@main/)).toBeTruthy();
  });

  it('submit button is disabled when textarea is empty', () => {
    render(<CommentsPanel taskId="gov-1" activities={[]} />);
    const btn = screen.getByRole('button', { name: /Post Comment/ });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('calls fetch on submit with correct body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<CommentsPanel taskId="gov-1" activities={[]} />);

    const textarea = screen.getByPlaceholderText('Write a comment...');
    fireEvent.change(textarea, { target: { value: 'My comment' } });

    const btn = screen.getByRole('button', { name: /Post Comment/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/write/tasks/comment',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ taskId: 'gov-1', text: 'My comment' }),
        }),
      );
    });
  });

  it('clears form on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    }));

    render(<CommentsPanel taskId="gov-1" activities={[]} />);

    const textarea = screen.getByPlaceholderText('Write a comment...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'My comment' } });

    fireEvent.click(screen.getByRole('button', { name: /Post Comment/ }));

    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('shows error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: 'Task not found' }),
    }));

    render(<CommentsPanel taskId="gov-1" activities={[]} />);

    fireEvent.change(screen.getByPlaceholderText('Write a comment...'), {
      target: { value: 'My comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Post Comment/ }));

    await waitFor(() => {
      expect(screen.getByText('Task not found')).toBeTruthy();
    });
  });

  it('shows 0 comments when no COMMENT_ADDED activities', () => {
    render(<CommentsPanel taskId="gov-1" activities={[ACTIVITIES[1]]} />);
    expect(screen.getByText('Comments (0)')).toBeTruthy();
  });
});
