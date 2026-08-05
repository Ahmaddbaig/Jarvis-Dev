import { describe, expect, it, vi } from 'vitest';
import { VoiceSessionController } from '../frontend/lib/voiceSession/session-controller';

describe('voice session controller', () => {
  it('owns a deterministic provider-neutral lifecycle snapshot', () => {
    const controller = new VoiceSessionController();
    controller.dispatch({ type: 'start-requested' });
    expect(controller.getSnapshot().phase).toBe('connecting');
    controller.dispatch({ type: 'connected' });
    controller.dispatch({ type: 'user-turn-committed' });
    expect(controller.getSnapshot().phase).toBe('thinking');
    controller.dispatch({ type: 'assistant-speaking' });
    expect(controller.getSnapshot().phase).toBe('speaking');
    controller.dispatch({ type: 'assistant-finished' });
    expect(controller.getSnapshot().phase).toBe('listening');
  });

  it('notifies subscribers once per real transition and supports unsubscribe', () => {
    const controller = new VoiceSessionController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.dispatch({ type: 'disconnected' });
    expect(listener).not.toHaveBeenCalled();
    controller.dispatch({ type: 'start-requested' });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    controller.dispatch({ type: 'connected' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('resets connection, error, reconnect, and mute state atomically', () => {
    const controller = new VoiceSessionController();
    controller.dispatch({ type: 'microphone-muted', muted: true });
    controller.dispatch({ type: 'start-requested' });
    controller.dispatch({ type: 'reconnect-scheduled' });
    controller.dispatch({ type: 'failed', message: 'Synthetic failure' });
    controller.reset();
    expect(controller.getSnapshot()).toEqual({
      phase: 'idle',
      lastError: null,
      micMuted: false,
      reconnectAttempt: 0,
    });
  });
});
