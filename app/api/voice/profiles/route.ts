import { NextResponse } from 'next/server';
import { listProfiles } from '@/backend/localvoice/voicebox';

/**
 * Voicebox status + voice profile list for the Settings UI.
 * GET → { ok, profiles: [{ id, name, voiceType?, engine?, voiceId? }], error? }
 *
 * The voice detail fields let Settings show WHICH voice a profile speaks
 * with (e.g. "kokoro · bm_daniel" vs "cloned · qwen-tts-1.7B"), so a custom
 * voice configured in the Voicebox app is visibly the one Jarvis uses.
 */

export async function GET() {
  try {
    const profiles = await listProfiles();
    return NextResponse.json({
      ok: true,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        voiceType: p.voice_type ?? undefined,
        engine: p.default_engine ?? p.preset_engine ?? undefined,
        voiceId: p.preset_voice_id ?? undefined,
      })),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      profiles: [],
      error: 'Voicebox is not reachable — install and open the Voicebox app.',
    });
  }
}
