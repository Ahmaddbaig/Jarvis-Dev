import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeLanSessionSchema,
  exchangeLanPairingSchema,
} from '@jarvis/contracts';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import {
  getLanSessionService,
  LanGatewayAuthError,
} from '@/backend/gateway/lan-session-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  if (error instanceof LanGatewayAuthError) {
    return NextResponse.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  return NextResponse.json({ error: 'LAN session authorization failed.' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'The LAN gateway trust channel is required.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { action?: unknown; input?: unknown } | null;
  try {
    if (body?.action === 'exchange') {
      const parsed = exchangeLanPairingSchema.safeParse(body.input);
      if (!parsed.success) return NextResponse.json({ error: 'Pairing request is invalid.' }, { status: 400 });
      return NextResponse.json(getLanSessionService().exchange(parsed.data), { status: 201 });
    }
    if (body?.action === 'authorize') {
      const parsed = authorizeLanSessionSchema.safeParse(body.input);
      if (!parsed.success) return NextResponse.json({ error: 'Authorization request is invalid.' }, { status: 400 });
      return NextResponse.json({ client: getLanSessionService().authorize(parsed.data) });
    }
    return NextResponse.json({ error: 'Unsupported LAN session action.' }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
