import { opsFetch } from '@/lib/ops-fetch';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const data = await opsFetch<{ unreadCount: number }>('/ops/notifications', {
      unread_only: '1',
      limit: '0',
    });
    return NextResponse.json({ unreadCount: data.unreadCount });
  } catch {
    return NextResponse.json({ unreadCount: 0 });
  }
}
