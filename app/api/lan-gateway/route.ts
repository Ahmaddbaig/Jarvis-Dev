import { NextRequest, NextResponse } from 'next/server';
import { createLanPairingSchema } from '@jarvis/contracts';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import { getLanSessionService } from '@/backend/gateway/lan-session-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function desktopOnly() {
  return NextResponse.json({ error: 'LAN client management is desktop-only.' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return desktopOnly();
  const service = getLanSessionService();
  return NextResponse.json({
    pairing: service.currentPairing(),
    clients: service.listClients(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return desktopOnly();
  const parsed = createLanPairingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'LAN pairing scopes are invalid.', issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json({ pairing: getLanSessionService().createPairing(parsed.data.scopes) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return desktopOnly();
  const body = await req.json().catch(() => null) as { id?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id.startsWith('lan-client:')) {
    return NextResponse.json({ error: 'A valid LAN client id is required.' }, { status: 400 });
  }
  return NextResponse.json({ revoked: getLanSessionService().revoke(body.id) });
}
