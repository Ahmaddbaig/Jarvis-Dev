export type VoiceSessionStatus = 'idle' | 'listening' | 'active' | 'error';
export type VoiceSessionPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'reconnecting'
  | 'failed';

export interface VoiceSessionState {
  phase: VoiceSessionPhase;
  lastError: string | null;
  micMuted: boolean;
  reconnectAttempt: number;
}

export type VoiceSessionEvent =
  | { type: 'start-requested' }
  | { type: 'connected' }
  | { type: 'user-turn-committed' }
  | { type: 'assistant-speaking' }
  | { type: 'assistant-finished' }
  | { type: 'reconnect-scheduled' }
  | { type: 'disconnected' }
  | { type: 'failed'; message?: string }
  | { type: 'microphone-muted'; muted: boolean };

export const INITIAL_VOICE_SESSION_STATE: Readonly<VoiceSessionState> = Object.freeze({
  phase: 'idle',
  lastError: null,
  micMuted: false,
  reconnectAttempt: 0,
});

export function voiceSessionStatus(phase: VoiceSessionPhase): VoiceSessionStatus {
  if (phase === 'idle') return 'idle';
  if (phase === 'connecting' || phase === 'reconnecting') return 'listening';
  if (phase === 'failed') return 'error';
  return 'active';
}

export function voiceSessionReducer(
  state: VoiceSessionState,
  event: VoiceSessionEvent,
): VoiceSessionState {
  switch (event.type) {
    case 'start-requested':
      return { ...state, phase: 'connecting', lastError: null };
    case 'connected':
      if (state.phase !== 'connecting' && state.phase !== 'reconnecting') return state;
      return { ...state, phase: 'listening', lastError: null, reconnectAttempt: 0 };
    case 'user-turn-committed':
      if (!['listening', 'speaking'].includes(state.phase)) return state;
      return { ...state, phase: 'thinking' };
    case 'assistant-speaking':
      if (!['listening', 'thinking', 'speaking'].includes(state.phase)) return state;
      return { ...state, phase: 'speaking' };
    case 'assistant-finished':
      if (state.phase !== 'thinking' && state.phase !== 'speaking') return state;
      return { ...state, phase: 'listening' };
    case 'reconnect-scheduled':
      if (state.phase === 'idle' || state.phase === 'failed') return state;
      return { ...state, phase: 'reconnecting', reconnectAttempt: state.reconnectAttempt + 1 };
    case 'disconnected':
      if (state.phase === 'idle' && state.reconnectAttempt === 0) return state;
      return { ...state, phase: 'idle', reconnectAttempt: 0 };
    case 'failed': {
      if (state.phase === 'idle') return state;
      const lastError = event.message ?? state.lastError;
      if (state.phase === 'failed' && state.lastError === lastError) return state;
      return { ...state, phase: 'failed', lastError };
    }
    case 'microphone-muted':
      return state.micMuted === event.muted ? state : { ...state, micMuted: event.muted };
  }
}
