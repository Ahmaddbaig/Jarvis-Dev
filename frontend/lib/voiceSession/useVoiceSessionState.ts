'use client';

import { useCallback, useReducer } from 'react';
import {
  INITIAL_VOICE_SESSION_STATE,
  voiceSessionReducer,
} from './state';

export function useVoiceSessionState() {
  const [state, dispatch] = useReducer(voiceSessionReducer, INITIAL_VOICE_SESSION_STATE);
  const starting = useCallback(() => dispatch({ type: 'start-requested' }), []);
  const connected = useCallback(() => dispatch({ type: 'connected' }), []);
  const disconnected = useCallback(() => dispatch({ type: 'disconnected' }), []);
  const fail = useCallback((message?: string) => dispatch({ type: 'failed', message }), []);
  const setMicrophoneMuted = useCallback(
    (muted: boolean) => dispatch({ type: 'microphone-muted', muted }),
    [],
  );

  return {
    ...state,
    connected,
    disconnected,
    fail,
    setMicrophoneMuted,
    starting,
  };
}
