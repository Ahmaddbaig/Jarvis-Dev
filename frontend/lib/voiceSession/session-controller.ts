import {
  INITIAL_VOICE_SESSION_STATE,
  voiceSessionReducer,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from './state';

export type VoiceSessionListener = () => void;

export class VoiceSessionController {
  #listeners = new Set<VoiceSessionListener>();
  #snapshot: VoiceSessionState = { ...INITIAL_VOICE_SESSION_STATE };

  getSnapshot = (): VoiceSessionState => this.#snapshot;

  subscribe = (listener: VoiceSessionListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispatch(event: VoiceSessionEvent): void {
    const next = voiceSessionReducer(this.#snapshot, event);
    if (next === this.#snapshot) return;
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  reset(): void {
    const next = { ...INITIAL_VOICE_SESSION_STATE };
    if (
      this.#snapshot.phase === next.phase &&
      this.#snapshot.lastError === next.lastError &&
      this.#snapshot.micMuted === next.micMuted &&
      this.#snapshot.reconnectAttempt === next.reconnectAttempt
    ) return;
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
