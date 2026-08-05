import { describe, expect, it } from 'vitest';
import {
  INITIAL_VOICE_SESSION_STATE,
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
    expect(listening).toEqual({ status: 'listening', lastError: null, micMuted: false });

    const active = voiceSessionReducer(listening, { type: 'connected' });
    expect(active).toEqual({ status: 'active', lastError: null, micMuted: false });

    const idle = voiceSessionReducer(active, { type: 'disconnected' });
    expect(idle).toEqual({ status: 'idle', lastError: null, micMuted: false });
  });

  it('keeps microphone state orthogonal to provider lifecycle', () => {
    const state = reduce([
      { type: 'microphone-muted', muted: true },
      { type: 'start-requested' },
      { type: 'connected' },
      { type: 'disconnected' },
    ]);
    expect(state).toEqual({ status: 'idle', lastError: null, micMuted: true });
  });

  it('records provider errors and clears them only when a new session starts or connects', () => {
    const failed = voiceSessionReducer(
      { ...INITIAL_VOICE_SESSION_STATE, status: 'listening' },
      { type: 'failed', message: 'Synthetic provider failure' },
    );
    expect(failed).toEqual({
      status: 'error',
      lastError: 'Synthetic provider failure',
      micMuted: false,
    });
    expect(voiceSessionReducer(failed, { type: 'disconnected' }).lastError)
      .toBe('Synthetic provider failure');
    expect(voiceSessionReducer(failed, { type: 'start-requested' }).lastError).toBeNull();
    expect(voiceSessionReducer(failed, { type: 'connected' }).lastError).toBeNull();
  });

  it('preserves the current error text when a provider reports only an error status', () => {
    const state = voiceSessionReducer(
      { status: 'active', lastError: 'Earlier detail', micMuted: false },
      { type: 'failed' },
    );
    expect(state).toEqual({ status: 'error', lastError: 'Earlier detail', micMuted: false });
  });

  it('does not allocate state for an unchanged microphone setting', () => {
    const state = { ...INITIAL_VOICE_SESSION_STATE };
    expect(voiceSessionReducer(state, { type: 'microphone-muted', muted: false })).toBe(state);
  });
});
