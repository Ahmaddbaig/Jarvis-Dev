'use client';

import { useCallback, useReducer } from 'react';
import {
  INITIAL_VOICE_SESSION_STATE,
  voiceSessionStatus,
  voiceSessionReducer,
} from './state';

export function useVoiceSessionState() {
  const [state, dispatch] = useReducer(voiceSessionReducer, INITIAL_VOICE_SESSION_STATE);
  const starting = useCallback(() => dispatch({ type: 'start-requested' }), []);
  const connected = useCallback(() => dispatch({ type: 'connected' }), []);
  const thinking = useCallback(() => dispatch({ type: 'user-turn-committed' }), []);
  const speaking = useCallback(() => dispatch({ type: 'assistant-speaking' }), []);
  const listening = useCallback(() => dispatch({ type: 'assistant-finished' }), []);
  const reconnecting = useCallback(() => dispatch({ type: 'reconnect-scheduled' }), []);
  const disconnected = useCallback(() => dispatch({ type: 'disconnected' }), []);
  const fail = useCallback((message?: string) => dispatch({ type: 'failed', message }), []);
  const setMicrophoneMuted = useCallback(
    (muted: boolean) => dispatch({ type: 'microphone-muted', muted }),
    [],
  );

  return {
    ...state,
    status: voiceSessionStatus(state.phase),
    connected,
    disconnected,
    fail,
    listening,
    reconnecting,
    setMicrophoneMuted,
    speaking,
    starting,
    thinking,
  };
}
