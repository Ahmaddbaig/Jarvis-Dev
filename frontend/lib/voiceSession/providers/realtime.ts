import type { ModelFunctionTool } from '../../tools/types';

export interface RealtimeSessionContext {
  instructions: string;
  transcriptionPrompt: string;
  tools: readonly ModelFunctionTool[];
}

export type RealtimeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RealtimeProviderAdapter {
  readonly engine: 'openai' | 'local';
  readonly label: string;
  readonly requiresCompleteIce: boolean;
  prepare(): Promise<void>;
  createAnswer(offerSdp: string): Promise<string>;
  createSessionUpdate(context: RealtimeSessionContext): Record<string, unknown>;
}

export class RealtimeProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RealtimeProviderError';
    this.code = code;
  }
}
