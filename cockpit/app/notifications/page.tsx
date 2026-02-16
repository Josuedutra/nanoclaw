import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { ErrorCallout } from '@/components/ErrorCallout';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';

interface GovNotification {
  id: number;
  task_id: string;
  target_group: string;
  actor: string;
  snippet: string;
  read: number;
  created_at: string;
}

export default async function NotificationsPage() {
  let notifications: GovNotification[] = [];
  let unreadCount = 0;
  let error = '';

  try {
    const data = await opsFetch<{
      notifications: GovNotification[];
      unreadCount: number;
    }>('/ops/notifications');
    notifications = data.notifications;
    unreadCount = data.unreadCount;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load notifications';
  }

  if (error) {
    return <ErrorCallout message={error} />;
  }

  const unreadIds = notifications.filter((n) => n.read === 0).map((n) => n.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 text-sm font-normal text-zinc-400">
              ({unreadCount} unread)
            </span>
          )}
        </h2>
        {unreadIds.length > 0 && <MarkAllReadButton ids={unreadIds} />}
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-zinc-500">No notifications</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded border px-4 py-2 text-sm ${
                n.read === 0
                  ? 'border-blue-800 bg-blue-950/30'
                  : 'border-zinc-800 bg-zinc-950'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-300">{n.actor}</span>
                <span className="text-xs text-zinc-600">→ @{n.target_group}</span>
                <span className="ml-auto text-xs text-zinc-600">{n.created_at}</span>
              </div>
              <div className="mt-1 text-zinc-400">{n.snippet}</div>
              <Link
                href={`/tasks/${encodeURIComponent(n.task_id)}`}
                className="mt-1 inline-block text-xs text-blue-400 hover:underline"
              >
                View task →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
