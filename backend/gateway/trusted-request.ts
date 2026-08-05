import type { NextRequest } from 'next/server';

export function lanRequestIdentity(request: NextRequest): {
  actorId: string;
  scopes: readonly string[];
} | null {
  if (request.headers.get('x-jarvis-gateway-verified') !== '1') return null;
  const actorId = request.headers.get('x-jarvis-lan-actor') ?? '';
  if (!actorId.startsWith('lan-client:')) return null;
  const scopes = (request.headers.get('x-jarvis-lan-scopes') ?? '')
    .split(',')
    .filter(Boolean);
  return { actorId, scopes };
}
