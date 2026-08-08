import { NextRequest, NextResponse } from 'next/server';
import { companionPreview } from '@/backend/companion/client';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json(
      { error: 'Companion display preview is available only in the Jarvis desktop app.' },
      { status: 401 }
    );
  }

  const target = req.nextUrl.searchParams.get('target')?.trim() || '';
  const screenRaw = req.nextUrl.searchParams.get('screen') || '0';
  const screen = Number(screenRaw);
  if (!target) {
    return NextResponse.json({ error: 'A companion target is required.' }, { status: 400 });
  }
  if (!Number.isInteger(screen) || screen < 0 || screen > 15) {
    return NextResponse.json({ error: 'Screen must be an integer from 0 to 15.' }, { status: 400 });
  }

  try {
    const preview = await companionPreview(target, screen);
    return NextResponse.json(preview, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Protocol v1 companions route an unknown authenticated endpoint through
    // their lease guard before reaching the 404 fallback.
    const needsUpdate = /unknown companion endpoint|claim a valid control lease first/i.test(message);
    return NextResponse.json(
      {
        error: needsUpdate
          ? 'This computer is running an older companion. Pull the latest branch and restart Jarvis Companion there.'
          : message,
      },
      { status: needsUpdate ? 426 : 502 }
    );
  }
}
