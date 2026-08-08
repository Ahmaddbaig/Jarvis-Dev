import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import { getCoreStore } from '@/backend/persistence/core-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json(
    { error: 'Storage administration is available only in the Jarvis desktop app.' },
    { status: 401 },
  );
}

export async function GET(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return unauthorized();
  try {
    return NextResponse.json(getCoreStore().diagnostics(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Storage diagnostics failed.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) return unauthorized();
  try {
    const body = await req.json() as { action?: unknown };
    if (body.action !== 'recovery-export') {
      return NextResponse.json({ error: 'Unsupported storage action.' }, { status: 400 });
    }
    const store = getCoreStore();
    const paths = store.createExportPaths();
    const pages = await store.database.backup(paths.database);
    store.database.exportJson(paths.json);
    return NextResponse.json({ ok: true, pages, files: paths }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recovery export failed.' },
      { status: 500 },
    );
  }
}
