import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/'];

/**
 * Verify session cookie using Web Crypto API (Edge-compatible).
 * Mirrors the HMAC logic in lib/auth.ts but without Node.js crypto.
 */
async function verifySessionEdge(cookie: string, secret: string): Promise<boolean> {
  if (!secret || !cookie) return false;
  const dot = cookie.lastIndexOf('.');
  if (dot < 1) return false;
  const sessionId = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionId));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return sig === expected;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check session cookie
  const cookie = request.cookies.get('nc_session')?.value;
  const secret = process.env.COCKPIT_SESSION_SECRET || '';
  const valid = cookie ? await verifySessionEdge(cookie, secret) : false;

  if (!valid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
