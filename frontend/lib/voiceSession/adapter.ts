export type VoiceSessionEngine = 'openai' | 'local' | 'elevenlabs' | 'voicebox';
export type VoiceActivityMode = 'listening' | 'speaking';

export interface VoiceSessionMessage {
  role: 'user' | 'assistant';
  message: string;
}

export interface VoiceSessionObserver {
  onConnected(): void;
  onDisconnected(reason?: string): void;
  onError(message: string): void;
  onMessage(message: VoiceSessionMessage): void;
  onModeChange(mode: VoiceActivityMode): void;
}

export interface VoiceSessionAdapter {
  readonly engine: VoiceSessionEngine;
  start(): Promise<void>;
  disconnect(): void | Promise<void>;
  setMicrophoneMuted(muted: boolean): void;
  sendText(message: string): void | Promise<void>;
  sendContext?(context: string): void | Promise<void>;
  getOutputLevel?(): number;
}
