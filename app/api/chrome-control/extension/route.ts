import { NextRequest, NextResponse } from 'next/server';
import {
  completeChromeCommand,
  pollChromeCommand,
  verifyChromeToken,
} from '@/backend/chrome/control';
import { ChromeControlResult } from '@/backend/chrome/types';
import {
  extensionCorsHeaders,
  extensionIdFromOrigin,
  extensionOrigin,
  forbidden,
} from '@/backend/chrome/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function bearerToken(req: NextRequest): string {
  const header = req.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function authorize(req: NextRequest): { origin: string; extensionId: string | null } | null {
  const origin = extensionOrigin(req);
  if (!origin) return null;
  const extensionId = extensionIdFromOrigin(origin);
  return verifyChromeToken(bearerToken(req), extensionId) ? { origin, extensionId } : null;
}

export async function OPTIONS(req: NextRequest) {
  const origin = extensionOrigin(req);
  if (!origin) return forbidden();
  return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(origin) });
}

export async function GET(req: NextRequest) {
  const auth = authorize(req);
  if (!auth) return forbidden('Chrome extension authentication failed. Re-pair the extension.');
  const command = await pollChromeCommand(12_000, req.signal);
  if (!command) return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(auth.origin) });
  return NextResponse.json({ command }, { headers: extensionCorsHeaders(auth.origin) });
}

export async function POST(req: NextRequest) {
  const auth = authorize(req);
  if (!auth) return forbidden('Chrome extension authentication failed. Re-pair the extension.');
  try {
    const body = await req.json() as Partial<ChromeControlResult>;
    if (typeof body.commandId !== 'string' || typeof body.ok !== 'boolean') {
      return NextResponse.json({ error: 'Invalid Chrome result.' }, {
        status: 400,
        headers: extensionCorsHeaders(auth.origin),
      });
    }
    const accepted = completeChromeCommand({
      commandId: body.commandId,
      ok: body.ok,
      result: body.result,
      error: typeof body.error === 'string' ? body.error.slice(0, 2_000) : undefined,
    });
    return NextResponse.json({ accepted }, {
      status: accepted ? 200 : 404,
      headers: extensionCorsHeaders(auth.origin),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: 400,
      headers: extensionCorsHeaders(auth.origin),
    });
  }
}
