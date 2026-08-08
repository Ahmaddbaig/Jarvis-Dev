import { describe, expect, it, vi } from 'vitest';
import { createLocalAIRealtimeAdapter } from '../frontend/lib/voiceSession/providers/localai-realtime';
import { createOpenAIRealtimeAdapter } from '../frontend/lib/voiceSession/providers/openai-realtime';
import type { RealtimeFetch } from '../frontend/lib/voiceSession/providers/realtime';

const context = {
  instructions: 'Synthetic safe instructions',
  transcriptionPrompt: 'Synthetic vocabulary',
  tools: [{
    type: 'function' as const,
    name: 'get_date',
    description: 'Get the date',
    parameters: { type: 'object', properties: {}, required: [] },
  }],
};

describe('OpenAI realtime adapter', () => {
  it('creates signaling and session-update payloads behind the common interface', async () => {
    const request = vi.fn<RealtimeFetch>(async () => new Response('answer-sdp'));
    const adapter = createOpenAIRealtimeAdapter({
      model: 'synthetic-realtime-model',
      voice: 'echo',
      fetch: request,
    });

    await adapter.prepare();
    await expect(adapter.createAnswer('offer-sdp')).resolves.toBe('answer-sdp');
    expect(adapter.engine).toBe('openai');
    expect(adapter.requiresCompleteIce).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('/api/voice/realtime');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      sdp: 'offer-sdp',
      model: 'synthetic-realtime-model',
      voice: 'echo',
    });

    expect(adapter.createSessionUpdate(context)).toMatchObject({
      type: 'session.update',
      session: {
        instructions: context.instructions,
        tools: context.tools,
        audio: { input: { turn_detection: { type: 'server_vad' } } },
      },
    });
  });

  it('keeps credentials server-side and redacts failed response bodies', async () => {
    const adapter = createOpenAIRealtimeAdapter({
      model: 'model',
      voice: 'echo',
      fetch: async () => new Response('SECRET_RESPONSE_BODY', { status: 401 }),
    });
    await expect(adapter.createAnswer('offer')).rejects.not.toThrow(/SECRET_RESPONSE_BODY/);
  });
});

describe('LocalAI realtime adapter', () => {
  it('checks readiness and installed profile before creating a JSON signaling exchange', async () => {
    const request = vi.fn<RealtimeFetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/readyz')) return new Response('ok');
      if (url.endsWith('/v1/models')) {
        return Response.json({ data: [{ id: 'jarvis-pipeline-m3' }] });
      }
      if (url.endsWith('/v1/realtime/calls')) return Response.json({ sdp: 'local-answer-sdp' });
      return new Response('not found', { status: 404 });
    });
    const adapter = createLocalAIRealtimeAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      pipelineModel: 'jarvis-pipeline-m3',
      transcriptionModel: 'whisper-m3',
      profileLabel: 'M3 profile',
      fetch: request,
    });

    await adapter.prepare();
    await expect(adapter.createAnswer('local-offer-sdp')).resolves.toBe('local-answer-sdp');
    expect(adapter.engine).toBe('local');
    expect(adapter.requiresCompleteIce).toBe(true);
    const signalingCall = request.mock.calls.find(([url]) => String(url).endsWith('/v1/realtime/calls'));
    expect(JSON.parse(String(signalingCall?.[1]?.body))).toEqual({
      sdp: 'local-offer-sdp',
      model: 'jarvis-pipeline-m3',
    });
    expect(adapter.createSessionUpdate(context)).toMatchObject({
      type: 'session.update',
      session: {
        instructions: context.instructions,
        tools: context.tools,
        max_output_tokens: 512,
        audio: {
          input: {
            transcription: { model: 'whisper-m3', prompt: context.transcriptionPrompt },
            turn_detection: { type: 'semantic_vad' },
          },
          output: { voice: '26' },
        },
      },
    });
  });

  it('reports the selected missing profile without downloading or switching models', async () => {
    const adapter = createLocalAIRealtimeAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      pipelineModel: 'missing-model',
      transcriptionModel: 'whisper',
      profileLabel: 'Synthetic profile',
      fetch: async (input) => String(input).endsWith('/readyz')
        ? new Response('ok')
        : Response.json({ data: [{ id: 'different-model' }] }),
    });
    await expect(adapter.prepare()).rejects.toMatchObject({ code: 'NOT_FOUND.LOCAL_MODEL' });
  });

  it('rejects a malformed signaling response with a stable provider error', async () => {
    const adapter = createLocalAIRealtimeAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      pipelineModel: 'model',
      transcriptionModel: 'whisper',
      profileLabel: 'Profile',
      fetch: async () => Response.json({}),
    });
    await expect(adapter.createAnswer('offer')).rejects.toMatchObject({
      code: 'VALIDATION.MISSING_SDP',
    });
  });
});
