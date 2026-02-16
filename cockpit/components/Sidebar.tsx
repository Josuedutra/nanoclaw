'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSse, type SseEvent } from '@/lib/use-sse';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/chat', label: 'Chat' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/products', label: 'Products' },
  { href: '/workers', label: 'Workers' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/memory', label: 'Memory' },
  { href: '/health', label: 'Health' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetch('/api/ops/notifications/count')
      .then((r) => r.json())
      .then((data: { unreadCount?: number }) => {
        if (typeof data.unreadCount === 'number') setUnreadCount(data.unreadCount);
      })
      .catch(() => {});
  }, [pathname]); // refetch when navigating

  const handleSseEvent = useCallback((event: SseEvent) => {
    if (event.type === 'notification:created') {
      setUnreadCount((c) => c + 1);
    }
  }, []);

  useSse(handleSseEvent);

  return (
    <nav className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 p-4">
      <h1 className="mb-6 text-lg font-bold text-white">NanoClaw</h1>
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center justify-between rounded px-3 py-2 text-sm ${
                  active
                    ? 'bg-zinc-800 text-white font-medium'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                {item.label}
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="ml-auto rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
