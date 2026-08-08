import { NextRequest, NextResponse } from 'next/server';
import {
  completeChromeCommand,
  pollChromeCommand,
  verifyChromeCompatibility,
  verifyChromeToken,
} from '@/backend/chrome/control';
import { remoteResultSchema } from '@jarvis/contracts';
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
  return verifyChromeToken(bearerToken(req), extensionId) && verifyChromeCompatibility()
    ? { origin, extensionId }
    : null;
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
  return NextResponse.json({ protocol: command.protocol, command }, { headers: extensionCorsHeaders(auth.origin) });
}

export async function POST(req: NextRequest) {
  const auth = authorize(req);
  if (!auth) return forbidden('Chrome extension authentication failed. Re-pair the extension.');
  try {
    const parsed = remoteResultSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid Chrome result.' }, {
        status: 400,
        headers: extensionCorsHeaders(auth.origin),
      });
    }
    const accepted = completeChromeCommand(parsed.data);
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
