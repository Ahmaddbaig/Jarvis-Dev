/**
 * Audio utilities for the local voice engine: WAV encoding of VAD segments
 * and a playback controller with an AnalyserNode so the HUD visualizer can
 * react to Jarvis's local voice.
 */

/** Encode mono Float32 PCM (as produced by the VAD, 16 kHz) into a WAV blob. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const HEADER_BYTES = 44;
  const buffer = new ArrayBuffer(HEADER_BYTES + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// The cloned voice reads fast; Chromium time-stretches with pitch preserved,
// so this slows delivery without deepening the voice. Playback is otherwise a
// direct, uncompressed path — no WebRTC loopback, no re-encoding — because
// the Opus loopback experiment audibly glitched the voice.
export const DEFAULT_VOICE_PLAYBACK_RATE = 0.8;

export function normalizePlaybackRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOICE_PLAYBACK_RATE;
  return Math.max(0.7, Math.min(1, value));
}

/** Plays TTS blobs through an <audio> element wired to an AnalyserNode. */
export class SpeechPlayer {
  private audioEl: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomain: Uint8Array<ArrayBuffer> | null = null;
  private currentUrl: string | null = null;
  private destroyed = false;
  private readonly playbackRate: number;

  constructor(playbackRate = DEFAULT_VOICE_PLAYBACK_RATE) {
    this.playbackRate = normalizePlaybackRate(playbackRate);
  }

  private ensureGraph(): HTMLAudioElement | null {
    if (this.destroyed) return null;
    if (this.audioEl) return this.audioEl;

    const audio = new Audio();
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    analyser.connect(context.destination);

    this.audioEl = audio;
    this.context = context;
    this.analyser = analyser;
    this.timeDomain = new Uint8Array(analyser.frequencyBinCount);
    return audio;
  }

  /** Resolves when playback finishes (or is stopped). No-op after destroy(). */
  async play(blob: Blob): Promise<void> {
    const audio = this.ensureGraph();
    if (!audio) return;
    this.stop();

    const url = URL.createObjectURL(blob);
    this.currentUrl = url;
    audio.src = url;
    audio.preservesPitch = true;
    audio.playbackRate = this.playbackRate;

    if (this.context?.state === 'suspended') {
      await this.context.resume().catch(() => undefined);
    }

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        audio.removeEventListener('ended', cleanup);
        audio.removeEventListener('pause', cleanup);
        audio.removeEventListener('error', cleanup);
        if (this.currentUrl === url) {
          URL.revokeObjectURL(url);
          this.currentUrl = null;
        }
        resolve();
      };
      audio.addEventListener('ended', cleanup);
      audio.addEventListener('pause', cleanup);
      audio.addEventListener('error', cleanup);
      audio.play().catch(() => cleanup());
    });
  }

  stop(): void {
    if (!this.audioEl) return;
    if (!this.audioEl.paused) this.audioEl.pause();
    this.audioEl.removeAttribute('src');
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  get isPlaying(): boolean {
    return !!this.audioEl && !this.audioEl.paused && !this.audioEl.ended;
  }

  /** 0-1 output level from the time-domain waveform (RMS, scaled). */
  getOutputVolume(): number {
    if (!this.analyser || !this.timeDomain || !this.isPlaying) return 0;
    this.analyser.getByteTimeDomainData(this.timeDomain);
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomain.length; i++) {
      const centered = (this.timeDomain[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / this.timeDomain.length);
    return Math.min(1, rms * 3.5);
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.context?.close().catch(() => undefined);
    this.audioEl = null;
    this.context = null;
    this.analyser = null;
    this.timeDomain = null;
  }
}
