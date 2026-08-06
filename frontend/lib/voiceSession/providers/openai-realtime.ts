import { realtimeAudioInput } from '@jarvis/contracts';
import {
  RealtimeProviderError,
  type RealtimeFetch,
  type RealtimeProviderAdapter,
  type RealtimeSessionContext,
} from './realtime';

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
            input: realtimeAudioInput(),
          },
          tools: [...context.tools],
        },
      };
    },
  };
}
