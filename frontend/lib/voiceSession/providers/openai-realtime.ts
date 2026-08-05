import {
  RealtimeProviderError,
  type RealtimeFetch,
  type RealtimeProviderAdapter,
  type RealtimeSessionContext,
} from './realtime';

const REALTIME_VAD_THRESHOLD = 0.7;

export interface OpenAIRealtimeOptions {
  apiKey: string;
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
    async prepare() {
      if (!options.apiKey.trim()) {
        throw new RealtimeProviderError('AUTH.NOT_CONFIGURED', 'No OpenAI API key is configured.');
      }
    },
    async createAnswer(offerSdp) {
      const form = new FormData();
      form.set('sdp', offerSdp);
      form.set('session', JSON.stringify({
        type: 'realtime',
        model: options.model,
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
          output: { voice: options.voice },
        },
      }));
      const response = await request('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
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
