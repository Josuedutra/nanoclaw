import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Sidebar } from './Sidebar';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
}));

// Mock use-sse to avoid SSE connection in tests
vi.mock('@/lib/use-sse', () => ({
  useSse: () => ({ connected: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Sidebar', () => {
  it('renders Notifications link', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ unreadCount: 0 }),
    }));

    render(<Sidebar />);
    expect(screen.getByText('Notifications')).toBeTruthy();
  });

  it('shows badge when unread count > 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ unreadCount: 5 }),
    }));

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText('5')).toBeTruthy();
    });
  });

  it('hides badge when count is 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ unreadCount: 0 }),
    }));

    render(<Sidebar />);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(screen.queryByText(/^\d+$/)).toBeNull();
    });
  });

  it('shows 99+ when count exceeds 99', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ unreadCount: 150 }),
    }));

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText('99+')).toBeTruthy();
    });
  });

  it('renders all nav items including Notifications', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ unreadCount: 0 }),
    }));

    render(<Sidebar />);

    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Health')).toBeTruthy();
  });
});
