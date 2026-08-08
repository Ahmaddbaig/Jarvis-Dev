import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { evaluateRequestBoundary } from '@/backend/gateway/request-boundary';

export function proxy(request: NextRequest) {
  const decision = evaluateRequestBoundary(request);
  if (!decision.allowed) {
    return NextResponse.json({
      error: 'Jarvis rejected this API request at the local trust boundary.',
      reason: decision.reason,
    }, {
      status: decision.status ?? 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(request.headers);
  headers.delete('x-jarvis-gateway-auth');
  headers.delete('x-jarvis-csrf-verified');
  headers.delete('x-jarvis-gateway-verified');
  if (decision.kind !== 'gateway') {
    headers.delete('x-jarvis-lan-actor');
    headers.delete('x-jarvis-lan-scopes');
    return NextResponse.next({ request: { headers } });
  }
  headers.set('x-jarvis-gateway-verified', '1');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
