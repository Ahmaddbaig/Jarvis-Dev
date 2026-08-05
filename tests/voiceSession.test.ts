import { describe, expect, it } from 'vitest';
import {
  INITIAL_VOICE_SESSION_STATE,
  voiceSessionStatus,
  voiceSessionReducer,
  type VoiceSessionState,
} from '../frontend/lib/voiceSession/state';

function reduce(events: Parameters<typeof voiceSessionReducer>[1][]): VoiceSessionState {
  return events.reduce(voiceSessionReducer, { ...INITIAL_VOICE_SESSION_STATE });
}

describe('provider-neutral voice session state', () => {
  it('models the existing start, connect, and disconnect lifecycle', () => {
    const listening = voiceSessionReducer(
      { ...INITIAL_VOICE_SESSION_STATE, lastError: 'old failure' },
      { type: 'start-requested' },
    );
    expect(listening).toEqual({ phase: 'connecting', lastError: null, micMuted: false, reconnectAttempt: 0 });
    expect(voiceSessionStatus(listening.phase)).toBe('listening');

    const active = voiceSessionReducer(listening, { type: 'connected' });
    expect(active).toEqual({ phase: 'listening', lastError: null, micMuted: false, reconnectAttempt: 0 });
    expect(voiceSessionStatus(active.phase)).toBe('active');

    const idle = voiceSessionReducer(active, { type: 'disconnected' });
    expect(idle).toEqual({ phase: 'idle', lastError: null, micMuted: false, reconnectAttempt: 0 });
  });

  it('keeps microphone state orthogonal to provider lifecycle', () => {
    const state = reduce([
      { type: 'microphone-muted', muted: true },
      { type: 'start-requested' },
      { type: 'connected' },
      { type: 'disconnected' },
    ]);
    expect(state).toEqual({ phase: 'idle', lastError: null, micMuted: true, reconnectAttempt: 0 });
  });

  it('records provider errors and clears them only when a new session starts or connects', () => {
    const failed = voiceSessionReducer(
      { ...INITIAL_VOICE_SESSION_STATE, phase: 'connecting' },
      { type: 'failed', message: 'Synthetic provider failure' },
    );
    expect(failed).toEqual({
      phase: 'failed',
      lastError: 'Synthetic provider failure',
      micMuted: false,
      reconnectAttempt: 0,
    });
    expect(voiceSessionReducer(failed, { type: 'disconnected' }).lastError)
      .toBe('Synthetic provider failure');
    const restarted = voiceSessionReducer(failed, { type: 'start-requested' });
    expect(restarted.lastError).toBeNull();
    expect(voiceSessionReducer(restarted, { type: 'connected' }).lastError).toBeNull();
  });

  it('preserves the current error text when a provider reports only an error status', () => {
    const state = voiceSessionReducer(
      { phase: 'listening', lastError: 'Earlier detail', micMuted: false, reconnectAttempt: 0 },
      { type: 'failed' },
    );
    expect(state).toEqual({ phase: 'failed', lastError: 'Earlier detail', micMuted: false, reconnectAttempt: 0 });
  });

  it('models thinking, speaking, interruption recovery, and reconnect attempts', () => {
    const state = reduce([
      { type: 'start-requested' },
      { type: 'connected' },
      { type: 'user-turn-committed' },
      { type: 'assistant-speaking' },
      { type: 'assistant-finished' },
      { type: 'reconnect-scheduled' },
      { type: 'reconnect-scheduled' },
    ]);
    expect(state.phase).toBe('reconnecting');
    expect(state.reconnectAttempt).toBe(2);
    expect(voiceSessionStatus(state.phase)).toBe('listening');
  });

  it('deduplicates repeated provider failures', () => {
    const failed = voiceSessionReducer(
      { ...INITIAL_VOICE_SESSION_STATE, phase: 'connecting' },
      { type: 'failed', message: 'Connection failed' },
    );
    expect(voiceSessionReducer(failed, { type: 'failed', message: 'Connection failed' })).toBe(failed);
  });

  it('ignores stale provider events after an intentional disconnect', () => {
    const idle = { ...INITIAL_VOICE_SESSION_STATE };
    expect(voiceSessionReducer(idle, { type: 'connected' })).toBe(idle);
    expect(voiceSessionReducer(idle, { type: 'assistant-speaking' })).toBe(idle);
    expect(voiceSessionReducer(idle, { type: 'failed', message: 'late failure' })).toBe(idle);
  });

  it('does not allocate state for an unchanged microphone setting', () => {
    const state = { ...INITIAL_VOICE_SESSION_STATE };
    expect(voiceSessionReducer(state, { type: 'microphone-muted', muted: false })).toBe(state);
  });
});
