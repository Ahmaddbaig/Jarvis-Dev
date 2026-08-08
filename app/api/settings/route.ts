import { NextRequest, NextResponse } from 'next/server';
import { getCoreStore } from '@/backend/persistence/core-store';
import { getCredentialService } from '@/backend/secrets/credential-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      ...getCoreStore().readServerSettings(),
      credentialStatus: getCredentialService().status(),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settings storage is unavailable.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Settings patch must be a JSON object.' }, { status: 400 });
    }
    const store = getCoreStore();
    store.writeServerSettings(body as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settings could not be saved.' },
      { status: 400 },
    );
  }
}
