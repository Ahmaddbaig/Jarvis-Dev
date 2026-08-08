/**
 * Audio configuration for the OpenAI realtime transport.
 *
 * The same settings are applied twice per session: once by the desktop route
 * that creates the call, and once by the renderer's `session.update` after the
 * data channel opens. Both must describe the same session, so the shape lives
 * here rather than being written out at each site.
 */

export const REALTIME_VAD_THRESHOLD = 0.7;

export const REALTIME_TRANSCRIPTION_PROMPT =
  'The speaker may address an assistant named Jarvis. Spell the wake word as Jarvis.';

export interface RealtimeAudioInputConfig {
  readonly noise_reduction: { readonly type: string };
  readonly transcription: {
    readonly model: string;
    readonly language: string;
    readonly prompt: string;
  };
  readonly turn_detection: {
    readonly type: string;
    readonly threshold: number;
    readonly prefix_padding_ms: number;
    readonly silence_duration_ms: number;
    readonly create_response: boolean;
    readonly interrupt_response: boolean;
  };
}

export function realtimeAudioInput(): RealtimeAudioInputConfig {
  return {
    noise_reduction: { type: 'far_field' },
    transcription: {
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
      prompt: REALTIME_TRANSCRIPTION_PROMPT,
    },
    turn_detection: {
      type: 'server_vad',
      threshold: REALTIME_VAD_THRESHOLD,
      prefix_padding_ms: 500,
      silence_duration_ms: 650,
      create_response: false,
      interrupt_response: true,
    },
  };
}
