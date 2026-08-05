import { NextRequest, NextResponse } from 'next/server';
import { jarvisVoiceSchema, realtimeModelSchema } from '@jarvis/contracts';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import { getCredentialService } from '@/backend/secrets/credential-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REALTIME_VAD_THRESHOLD = 0.7;

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Realtime voice is available only in the Jarvis desktop app.' }, { status: 401 });
  }
  try {
    const body = await req.json() as { sdp?: unknown; model?: unknown; voice?: unknown };
    const model = realtimeModelSchema.safeParse(body.model);
    const voice = jarvisVoiceSchema.safeParse(body.voice);
    if (typeof body.sdp !== 'string' || !body.sdp || body.sdp.length > 1_048_576 || !model.success || !voice.success) {
      return NextResponse.json({ error: 'Realtime session request is invalid.' }, { status: 400 });
    }
    const apiKey = getCredentialService().get('openaiApiKey');
    if (!apiKey) return NextResponse.json({ error: 'OpenAI is not configured.' }, { status: 401 });

    const form = new FormData();
    form.set('sdp', body.sdp);
    form.set('session', JSON.stringify({
      type: 'realtime',
      model: model.data,
      audio: {
        input: {
          noise_reduction: { type: 'far_field' },
          transcription: {
            model: 'gpt-4o-mini-transcribe',
            language: 'en',
            prompt: 'The speaker may address an assistant named Jarvis. Spell the wake word as Jarvis.',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: REALTIME_VAD_THRESHOLD,
            prefix_padding_ms: 500,
            silence_duration_ms: 650,
            create_response: false,
            interrupt_response: true,
          },
        },
        output: { voice: voice.data },
      },
    }));
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: req.signal,
    });
    if (!response.ok) {
      return NextResponse.json({ error: `OpenAI realtime session failed with HTTP ${response.status}.` }, { status: 502 });
    }
    return new Response(await response.text(), {
      status: 200,
      headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Realtime session creation failed.' },
      { status: 500 },
    );
  }
}
