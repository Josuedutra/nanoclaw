import { type NextRequest, NextResponse } from 'next/server';
import { opsFetch } from '@/lib/ops-fetch';

export async function GET(request: NextRequest) {
  try {
    const params: Record<string, string> = {};
    const group = request.nextUrl.searchParams.get('group');
    if (group) params.group = group;
    const data = await opsFetch('/ops/topics', params);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
