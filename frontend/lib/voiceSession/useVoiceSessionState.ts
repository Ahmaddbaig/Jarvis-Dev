'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { VoiceSessionController } from './session-controller';
import { voiceSessionStatus } from './state';

export function useVoiceSessionState() {
  const [controller] = useState(() => new VoiceSessionController());
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const starting = useCallback(() => controller.dispatch({ type: 'start-requested' }), [controller]);
  const connected = useCallback(() => controller.dispatch({ type: 'connected' }), [controller]);
  const thinking = useCallback(() => controller.dispatch({ type: 'user-turn-committed' }), [controller]);
  const speaking = useCallback(() => controller.dispatch({ type: 'assistant-speaking' }), [controller]);
  const listening = useCallback(() => controller.dispatch({ type: 'assistant-finished' }), [controller]);
  const reconnecting = useCallback(() => controller.dispatch({ type: 'reconnect-scheduled' }), [controller]);
  const disconnected = useCallback(() => controller.dispatch({ type: 'disconnected' }), [controller]);
  const fail = useCallback((message?: string) => controller.dispatch({ type: 'failed', message }), [controller]);
  const setMicrophoneMuted = useCallback(
    (muted: boolean) => controller.dispatch({ type: 'microphone-muted', muted }),
    [controller],
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
