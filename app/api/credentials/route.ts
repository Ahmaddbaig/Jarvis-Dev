import { NextRequest, NextResponse } from 'next/server';
import {
  credentialKeySchema,
  credentialPatchSchema,
} from '@jarvis/contracts';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import { getCredentialService } from '@/backend/secrets/credential-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json(
    { error: 'Credential management is available only in the Jarvis desktop app.' },
    { status: 401 },
  );
}

export async function GET(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return unauthorized();
  try {
    return NextResponse.json({ configured: getCredentialService().status() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Credential status is unavailable.' },
      { status: 503 },
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return unauthorized();
  try {
    const body = await req.json() as unknown;
    const parsed = credentialPatchSchema.safeParse(
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { credentials?: unknown }).credentials
        : undefined,
    );
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'Credential patch is invalid.' }, { status: 400 });
    }
    const service = getCredentialService();
    service.setMany(parsed.data);
    return NextResponse.json({ ok: true, configured: service.status() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Credentials could not be saved.' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return unauthorized();
  try {
    const body = await req.json() as { keys?: unknown };
    const parsed = credentialKeySchema.array().min(1).safeParse(body.keys);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Credential keys are invalid.' }, { status: 400 });
    }
    const service = getCredentialService();
    for (const key of parsed.data) service.delete(key);
    return NextResponse.json({ ok: true, configured: service.status() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Credentials could not be removed.' },
      { status: 500 },
    );
  }
}
