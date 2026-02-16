import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EvidenceBulkForm } from './EvidenceBulkForm';

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// Mock sessionStorage
const sessionStorageMock = { getItem: vi.fn(() => 'test-csrf') };
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function okResponse() {
  return Promise.resolve({
    json: () => Promise.resolve({ ok: true, addedCount: 2, evidenceCount: 2 }),
  });
}

function errorResponse(error: string) {
  return Promise.resolve({
    json: () => Promise.resolve({ error }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvidenceBulkForm', () => {
  it('renders textarea and submit button', () => {
    render(<EvidenceBulkForm taskId="t1" />);
    expect(screen.getByPlaceholderText(/Paste URLs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bulk Add/ })).toBeInTheDocument();
  });

  it('submit button is disabled when textarea is empty', () => {
    render(<EvidenceBulkForm taskId="t1" />);
    const btn = screen.getByRole('button', { name: /Bulk Add/ });
    expect(btn).toBeDisabled();
  });

  it('shows per-line errors for invalid URLs', () => {
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'https://good.com\nnot-a-url\nhttps://also-good.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    expect(screen.getByText(/Line 2: invalid URL/)).toBeInTheDocument();
    // fetch NOT called because of client-side validation failure
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows error when exceeding 20 links', () => {
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    const lines = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`).join('\n');
    fireEvent.change(textarea, { target: { value: lines } });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    expect(screen.getByText(/Maximum 20/)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows error for non-http/https scheme', () => {
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'ftp://bad.com/file' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    expect(screen.getByText(/Line 1: must be http or https/)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('submits valid links and clears form on success', async () => {
    mockFetch.mockImplementationOnce(okResponse);
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'https://a.com\nhttps://b.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/write/tasks/evidence/bulk');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.taskId).toBe('t1');
    expect(body.links).toEqual(['https://a.com', 'https://b.com']);

    // Form cleared after success
    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  it('sends shared note with links', async () => {
    mockFetch.mockImplementationOnce(okResponse);
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    const noteInput = screen.getByPlaceholderText(/Shared note/);

    fireEvent.change(textarea, { target: { value: 'https://a.com' } });
    fireEvent.change(noteInput, { target: { value: 'Sprint 10 evidence' } });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.note).toBe('Sprint 10 evidence');
  });

  it('shows server error on API failure', async () => {
    mockFetch.mockImplementationOnce(() => errorResponse('Metadata too large'));
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'https://a.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    await waitFor(() => {
      expect(screen.getByText(/Metadata too large/)).toBeInTheDocument();
    });
  });

  it('shows error on network failure', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network down')));
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'https://a.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    await waitFor(() => {
      expect(screen.getByText(/Network down/)).toBeInTheDocument();
    });
  });

  it('ignores empty lines when parsing URLs', () => {
    mockFetch.mockImplementationOnce(okResponse);
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'https://a.com\n\n\nhttps://b.com\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Bulk Add/ }));

    // No errors — empty lines filtered out
    expect(screen.queryByText(/invalid URL/)).not.toBeInTheDocument();
  });

  it('shows link count in button text', () => {
    render(<EvidenceBulkForm taskId="t1" />);
    const textarea = screen.getByPlaceholderText(/Paste URLs/);
    fireEvent.change(textarea, {
      target: { value: 'https://a.com\nhttps://b.com\nhttps://c.com' },
    });
    expect(screen.getByRole('button', { name: /Bulk Add \(3\)/ })).toBeInTheDocument();
  });
});
