import {
  RealtimeProviderError,
  type RealtimeFetch,
  type RealtimeProviderAdapter,
  type RealtimeSessionContext,
} from './realtime';

const REALTIME_VAD_THRESHOLD = 0.7;

export interface OpenAIRealtimeOptions {
  model: string;
  voice: string;
  fetch?: RealtimeFetch;
}

export function createOpenAIRealtimeAdapter(options: OpenAIRealtimeOptions): RealtimeProviderAdapter {
  const request = options.fetch ?? fetch;
  return {
    engine: 'openai',
    label: 'OpenAI',
    requiresCompleteIce: false,
    async prepare() {},
    async createAnswer(offerSdp) {
      const response = await request('/api/voice/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offerSdp, model: options.model, voice: options.voice }),
      });
      if (!response.ok) {
        throw new RealtimeProviderError(
          'TRANSIENT.SESSION_CREATE_FAILED',
          `OpenAI realtime session failed with HTTP ${response.status}.`,
        );
      }
      return response.text();
    },
    createSessionUpdate(context: RealtimeSessionContext) {
      return {
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: context.instructions,
          tool_choice: 'auto',
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
          },
          tools: [...context.tools],
        },
      };
    },
  };
}
