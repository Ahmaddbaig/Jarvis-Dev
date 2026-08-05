import { NextRequest, NextResponse } from 'next/server';
import { warmUpProfileEngine } from '@/backend/localvoice/voicebox';

/**
 * Preload the Voicebox TTS engine for the configured voice profile.
 * POST { profileId? } → { ok, engine, wasLoaded, tookMs }
 *
 * Fired at session start so the ~40s cold model load happens while the app
 * boots instead of on the user's first question.
 */

export async function POST(req: NextRequest) {
  let profileId: string | undefined;
  try {
    const body = (await req.json()) as { profileId?: string };
    profileId = typeof body.profileId === 'string' && body.profileId.trim()
      ? body.profileId.trim()
      : undefined;
  } catch {
    // Empty body is fine — warm the default profile's engine.
  }

  const startedAt = Date.now();
  try {
    const { engine, wasLoaded } = await warmUpProfileEngine(profileId);
    return NextResponse.json({
      ok: true,
      engine,
      wasLoaded,
      tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Warmup failed';
    console.error('[voice/warmup]', message);
    return NextResponse.json(
      {
        ok: false,
        error: message.includes('fetch failed') || message.includes('timeout')
          ? 'Voicebox is not reachable — is the Voicebox app running?'
          : message,
      },
      { status: 502 },
    );
  }
}
