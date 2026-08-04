import { NextRequest, NextResponse } from 'next/server';
import {
  chromeControlStatus,
  createChromeCommand,
  createChromePairingCode,
  issueChromeCommand,
  revokeChromePairing,
} from '@/backend/chrome/control';
import { forbidden, isJarvisUiRequest, isLoopbackRequest } from '@/backend/chrome/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isLoopbackRequest(req)) return forbidden();
  return NextResponse.json(chromeControlStatus(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!isJarvisUiRequest(req)) return forbidden();

  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.operation === 'create_pairing') {
      return NextResponse.json({ ...createChromePairingCode(), status: chromeControlStatus() });
    }
    if (body.operation === 'revoke_pairing') {
      revokeChromePairing();
      return NextResponse.json({ success: true, status: chromeControlStatus() });
    }
    if (body.operation === 'command') {
      const command = createChromeCommand(body.action, body.args);
      const result = await issueChromeCommand(command);
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: 'Unknown Chrome control operation.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
