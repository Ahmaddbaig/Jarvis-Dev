export type VoiceSessionStatus = 'idle' | 'listening' | 'active' | 'error';

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  lastError: string | null;
  micMuted: boolean;
}

export type VoiceSessionEvent =
  | { type: 'start-requested' }
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'failed'; message?: string }
  | { type: 'microphone-muted'; muted: boolean };

export const INITIAL_VOICE_SESSION_STATE: Readonly<VoiceSessionState> = Object.freeze({
  status: 'idle',
  lastError: null,
  micMuted: false,
});

export function voiceSessionReducer(
  state: VoiceSessionState,
  event: VoiceSessionEvent,
): VoiceSessionState {
  switch (event.type) {
    case 'start-requested':
      return { ...state, status: 'listening', lastError: null };
    case 'connected':
      return { ...state, status: 'active', lastError: null };
    case 'disconnected':
      return { ...state, status: 'idle' };
    case 'failed':
      return { ...state, status: 'error', lastError: event.message ?? state.lastError };
    case 'microphone-muted':
      return state.micMuted === event.muted ? state : { ...state, micMuted: event.muted };
  }
}
