import {
  RealtimeProviderError,
  type RealtimeFetch,
  type RealtimeProviderAdapter,
  type RealtimeSessionContext,
} from './realtime';

export interface LocalAIRealtimeOptions {
  baseUrl: string;
  pipelineModel: string;
  transcriptionModel: string;
  profileLabel: string;
  fetch?: RealtimeFetch;
  readinessTimeoutMs?: number;
}

export function createLocalAIRealtimeAdapter(options: LocalAIRealtimeOptions): RealtimeProviderAdapter {
  const request = options.fetch ?? fetch;
  return {
    engine: 'local',
    label: 'LocalAI',
    requiresCompleteIce: true,
    async prepare() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.readinessTimeoutMs ?? 5_000);
      try {
        const readyResponse = await request(`${options.baseUrl}/readyz`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!readyResponse.ok) {
          throw new RealtimeProviderError(
            'TRANSIENT.READINESS_FAILED',
            `LocalAI health check returned HTTP ${readyResponse.status}.`,
          );
        }
        const modelsResponse = await request(`${options.baseUrl}/v1/models`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!modelsResponse.ok) {
          throw new RealtimeProviderError(
            'TRANSIENT.MODEL_CHECK_FAILED',
            `LocalAI model check returned HTTP ${modelsResponse.status}.`,
          );
        }
        const payload = await modelsResponse.json() as { data?: Array<{ id?: string }> };
        const installedModels = new Set((payload.data ?? []).map((model) => model.id));
        if (!installedModels.has(options.pipelineModel)) {
          throw new RealtimeProviderError(
            'NOT_FOUND.LOCAL_MODEL',
            `${options.profileLabel} is selected but its model is not installed on this Mac. ` +
              'Run scripts/local-ai/install-macos.zsh for the matching Mac profile; switching profiles never downloads models automatically.',
          );
        }
      } catch (error) {
        if (error instanceof RealtimeProviderError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new RealtimeProviderError(
            'TRANSIENT.READINESS_TIMEOUT',
            `LocalAI did not respond within ${(options.readinessTimeoutMs ?? 5_000) / 1_000} seconds at ${options.baseUrl}. Start Jarvis with RUN-JARVIS-DEV.command.`,
          );
        }
        if (error instanceof TypeError) {
          throw new RealtimeProviderError(
            'TRANSIENT.UNREACHABLE',
            `Cannot reach LocalAI at ${options.baseUrl}. Start Jarvis with RUN-JARVIS-DEV.command.`,
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    async createAnswer(offerSdp) {
      const response = await request(`${options.baseUrl}/v1/realtime/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offerSdp, model: options.pipelineModel }),
      });
      if (!response.ok) {
        throw new RealtimeProviderError(
          'TRANSIENT.SESSION_CREATE_FAILED',
          `LocalAI realtime session failed with HTTP ${response.status}.`,
        );
      }
      const call = await response.json() as { sdp?: string };
      if (!call.sdp) {
        throw new RealtimeProviderError(
          'VALIDATION.MISSING_SDP',
          'LocalAI returned a realtime session without an SDP answer.',
        );
      }
      return call.sdp;
    },
    createSessionUpdate(context: RealtimeSessionContext) {
      return {
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: context.instructions,
          tool_choice: 'auto',
          max_output_tokens: 512,
          audio: {
            input: {
              transcription: {
                model: options.transcriptionModel,
                language: 'en',
                prompt: context.transcriptionPrompt,
              },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'high',
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: '26' },
          },
          tools: [...context.tools],
        },
      };
    },
  };
}
