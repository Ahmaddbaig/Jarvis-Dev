import { NextRequest, NextResponse } from 'next/server';
import { generateSpeech, resolveProfile } from '@/backend/localvoice/voicebox';

/**
 * Turn assistant text into speech via Voicebox.
 * POST { text, profileId? } → audio bytes for in-app playback (the visualizer
 * needs the audio inside the renderer, so we do NOT use Voicebox /speak which
 * plays on its own output).
 */

const MAX_TEXT_CHARS = 4_000;

export async function POST(req: NextRequest) {
  let text = '';
  let profileId: string | undefined;
  try {
    const body = (await req.json()) as { text?: string; profileId?: string };
    text = typeof body.text === 'string' ? body.text.trim() : '';
    profileId = typeof body.profileId === 'string' && body.profileId.trim()
      ? body.profileId.trim()
      : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    text = `${text.slice(0, MAX_TEXT_CHARS)}…`;
  }

  try {
    const profile = await resolveProfile(profileId);
    const { audio, contentType } = await generateSpeech(text, profile);
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Speech generation failed';
    console.error('[voice/speak]', message);
    return NextResponse.json(
      { error: message.includes('fetch failed') || message.includes('timeout')
        ? 'Voicebox is not reachable — is the Voicebox app running?'
        : message },
      { status: 502 },
    );
  }
}
