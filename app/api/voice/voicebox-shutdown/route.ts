import { NextResponse } from 'next/server';
import { shutdownVoicebox } from '@/backend/localvoice/voicebox';

/**
 * POST — close the Voicebox sidecar. Called by the desktop shell on quit so
 * the TTS engine's ~1 GB of model memory is released when Jarvis is not
 * running. No-ops (with a reason) when Voicebox is unreachable or busy
 * downloading a voice model.
 */

export async function POST() {
  return NextResponse.json(await shutdownVoicebox());
}
