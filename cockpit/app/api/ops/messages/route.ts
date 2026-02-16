import { type NextRequest, NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(request: NextRequest) {
  try {
    const params: Record<string, string> = {};
    const limit = request.nextUrl.searchParams.get('limit');
    if (limit) params.limit = limit;
    const before = request.nextUrl.searchParams.get('before');
    if (before) params.before = before;
    const data = await opsFetch('/ops/messages', params);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
