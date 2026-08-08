import { NextRequest, NextResponse } from 'next/server';
import { pairChromeExtension } from '@/backend/chrome/control';
import {
  extensionCorsHeaders,
  extensionIdFromOrigin,
  extensionOrigin,
  forbidden,
} from '@/backend/chrome/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) {
  const origin = extensionOrigin(req);
  if (!origin) return forbidden();
  return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = extensionOrigin(req);
  if (!origin) return forbidden('Only a locally installed Chrome extension may pair with Jarvis.');

  try {
    const body = await req.json() as Record<string, unknown>;
    const originExtensionId = extensionIdFromOrigin(origin);
    const extensionId = String(body.extensionId || originExtensionId || '');
    if (originExtensionId && extensionId !== originExtensionId) {
      return NextResponse.json({ error: 'Extension identity does not match its Chrome origin.' }, {
        status: 403,
        headers: extensionCorsHeaders(origin),
      });
    }
    const paired = pairChromeExtension({
      code: String(body.code || ''),
      extensionId,
      extensionName: typeof body.extensionName === 'string' ? body.extensionName : undefined,
      protocol: body.protocol,
      extensionVersion: body.extensionVersion,
      capabilities: body.capabilities,
    });
    return NextResponse.json(paired, { headers: extensionCorsHeaders(origin) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: 400,
      headers: extensionCorsHeaders(origin),
    });
  }
}
