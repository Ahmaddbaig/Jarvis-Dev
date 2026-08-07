/**
 * Fully local voice pipeline:
 *   mic → VAD → WAV → /api/local-stt (whisper.cpp) → /api/local-llm (Ollama)
 *   → tool-call loop against the Jarvis function registry → speechSynthesis TTS.
 *
 * Nothing leaves the machine. The session borrows the mic MediaStream owned by
 * JarvisAssistant and never stops its tracks itself.
 */

/** Realtime-API-shaped tool spec, as stored in the function registry. */
export interface RealtimeToolSpec {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface LocalVoiceConfig {
  model: string;
  instructions: string;
  tools: RealtimeToolSpec[];
  /** speechSynthesis voice name; undefined = pick best available English voice. */
  voiceName?: string;
  /** Speech output engine: macOS speechSynthesis or the Voicebox app. */
  ttsEngine?: 'system' | 'voicebox';
  /** Voicebox profile name or id to speak with (e.g. "Jarvis"). */
  voiceboxProfile?: string;
  /** null = text-only session (no mic capture, typed input still works). */
  micStream: MediaStream | null;
}

export interface LocalVoiceCallbacks {
  /** Non-fatal problem (one utterance failed); session keeps listening. */
  onError: (message: string) => void;
  /** Wake-word / music gating. Return false to silently drop the utterance. */
  shouldAcceptUtterance: (transcript: string) => Promise<boolean>;
  /** Execute a registry function; mirrors the WebRTC data-channel behavior. */
  executeFunction: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ output: Record<string, unknown>; imageBase64?: string }>;
  /** Fired when a spoken response (or silent turn) fully completes. */
  onResponseDone: () => void;
}

const START_RMS = 0.015;      // speech onset threshold
const END_RMS = 0.008;        // below this counts as silence
const END_SILENCE_MS = 700;   // silence needed to close an utterance
const MIN_UTTERANCE_MS = 350; // shorter captures are discarded as noise
const MAX_UTTERANCE_MS = 30_000;
const PRE_ROLL_MS = 300;      // audio kept from just before speech onset
const TARGET_SAMPLE_RATE = 16_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_TOOL_ROUNDS = 6;

// Whisper's classic hallucinations on silence / breath noise.
const JUNK_TRANSCRIPTS = new Set([
  'you', 'thank you', 'thanks', 'thank you.', 'bye', 'the', 'uh', 'um',
  '[blank_audio]', '[silence]', '(silence)', '[music]', '(music)',
]);

function isJunkTranscript(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.,!?]+$/g, '').trim();
  return normalized.length < 2 || JUNK_TRANSCRIPTS.has(normalized);
}

/** Strip reasoning tags and markdown decorations so TTS reads clean prose. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, ' Code omitted. ')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toOllamaTools(tools: RealtimeToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function pickVoice(preferredName?: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  // Jarvis default: a British English voice if one exists, else any English.
  const gb = voices.filter((v) => /^en[-_]GB/i.test(v.lang));
  const preferredOrder = ['Daniel', 'Oliver', 'Serena', 'Kate', 'Stephanie'];
  for (const name of preferredOrder) {
    const match = gb.find((v) => v.name.includes(name));
    if (match) return match;
  }
  if (gb.length > 0) return gb[0];
  return voices.find((v) => /^en/i.test(v.lang)) ?? voices[0];
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

export class LocalVoiceSession {
  private config: LocalVoiceConfig;
  private callbacks: LocalVoiceCallbacks;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private history: OllamaChatMessage[] = [];
  private stopped = false;

  // VAD state
  private capturing = false;
  private busy = false; // transcribing / thinking / speaking — drop mic frames
  private captureChunks: Float32Array[] = [];
  private preRollChunks: { samples: Float32Array; ms: number }[] = [];
  private silenceMs = 0;
  private capturedMs = 0;

  constructor(config: LocalVoiceConfig, callbacks: LocalVoiceCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    // Warm the voice list — Chromium populates it asynchronously.
    window.speechSynthesis.getVoices();

    if (!this.config.micStream) return; // voicebox-only: no audio graph needed

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.config.micStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this.stopped || this.busy) return;
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      this.handleAudioFrame(samples);
    };

    this.sourceNode.connect(this.processor);
    // ScriptProcessor must be connected to a destination to fire; route through
    // a zero-gain node so mic audio is never audible.
    const mute = this.audioContext.createGain();
    mute.gain.value = 0;
    this.processor.connect(mute);
    mute.connect(this.audioContext.destination);
  }

  stop(): void {
    this.stopped = true;
    window.speechSynthesis.cancel();
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Voicebox path: typed input, no STT and no wake-word gating (typing is
   * always an intentional user turn). Interrupts any in-progress speech.
   */
  async sendText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.stopped) return;

    window.speechSynthesis.cancel(); // barge-in over current speech

    // Wait for any in-flight utterance to finish so history stays ordered.
    const deadline = Date.now() + 20_000;
    while (this.busy && !this.stopped && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.stopped) return;
    if (this.busy) {
      this.callbacks.onError('Jarvis is still working on the previous request — try again in a moment.');
      return;
    }

    this.busy = true;
    try {
      console.log(
        `%c[Jarvis Local] Voicebox: "${trimmed}"`,
        'background:#0d2137;color:#4fc3f7;padding:2px 6px;border-radius:3px',
      );
      await this.respondTo(trimmed);
      this.callbacks.onResponseDone();
    } catch (e) {
      this.callbacks.onError(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private frameMs(samples: Float32Array): number {
    return (samples.length / (this.audioContext?.sampleRate ?? 48_000)) * 1000;
  }

  private handleAudioFrame(samples: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const ms = this.frameMs(samples);

    if (!this.capturing) {
      // Keep a short pre-roll so the first syllable isn't clipped.
      this.preRollChunks.push({ samples, ms });
      let total = 0;
      for (let i = this.preRollChunks.length - 1; i >= 0; i--) total += this.preRollChunks[i].ms;
      while (total > PRE_ROLL_MS && this.preRollChunks.length > 1) {
        total -= this.preRollChunks[0].ms;
        this.preRollChunks.shift();
      }
      if (rms >= START_RMS) {
        this.capturing = true;
        this.captureChunks = this.preRollChunks.map((c) => c.samples);
        this.capturedMs = this.preRollChunks.reduce((acc, c) => acc + c.ms, 0);
        this.preRollChunks = [];
        this.silenceMs = 0;
      }
      return;
    }

    this.captureChunks.push(samples);
    this.capturedMs += ms;
    this.silenceMs = rms < END_RMS ? this.silenceMs + ms : 0;

    if (this.silenceMs >= END_SILENCE_MS || this.capturedMs >= MAX_UTTERANCE_MS) {
      const chunks = this.captureChunks;
      const durationMs = this.capturedMs - this.silenceMs;
      this.capturing = false;
      this.captureChunks = [];
      this.capturedMs = 0;
      this.silenceMs = 0;
      if (durationMs >= MIN_UTTERANCE_MS) {
        this.busy = true;
        void this.processUtterance(chunks);
      }
    }
  }

  private async processUtterance(chunks: Float32Array[]): Promise<void> {
    try {
      const contextRate = this.audioContext?.sampleRate ?? 48_000;
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      const wav = encodeWav(downsample(merged, contextRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);

      const sttRes = await fetch('/api/local-stt', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      });
      const sttData = (await sttRes.json()) as { text?: string; error?: string };
      if (!sttRes.ok || sttData.error) {
        throw new Error(sttData.error ?? `STT failed (${sttRes.status})`);
      }
      const transcript = (sttData.text ?? '').trim();
      if (!transcript || isJunkTranscript(transcript)) return;

      if (!(await this.callbacks.shouldAcceptUtterance(transcript))) return;

      console.log(
        `%c[Jarvis Local] Heard: "${transcript}"`,
        'background:#0d2137;color:#4fc3f7;padding:2px 6px;border-radius:3px',
      );
      await this.respondTo(transcript);
      this.callbacks.onResponseDone();
    } catch (e) {
      this.callbacks.onError(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private async respondTo(transcript: string): Promise<void> {
    this.history.push({ role: 'user', content: transcript });
    this.trimHistory();

    const tools = toOllamaTools(this.config.tools);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const messages: OllamaChatMessage[] = [
        { role: 'system', content: this.config.instructions },
        ...this.history,
      ];
      const res = await fetch('/api/local-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, messages, tools }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: OllamaChatMessage;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Local LLM request failed (${res.status})`);
      }

      const message = data.message ?? { role: 'assistant' as const, content: '' };
      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const speech = cleanForSpeech(message.content ?? '');
        this.history.push({ role: 'assistant', content: message.content ?? '' });
        this.trimHistory();
        if (speech) await this.speak(speech);
        return;
      }

      // Record the assistant turn that requested the calls, then execute each.
      this.history.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls });
      for (const call of toolCalls) {
        const name = call.function?.name ?? '';
        let args: Record<string, unknown> = {};
        const rawArgs = call.function?.arguments;
        if (typeof rawArgs === 'string') {
          try { args = JSON.parse(rawArgs || '{}'); } catch { args = {}; }
        } else if (rawArgs && typeof rawArgs === 'object') {
          args = rawArgs;
        }

        console.log(
          `%c[Jarvis Local] Tool call: ${name}(${JSON.stringify(args)})`,
          'background:#1a3a1a;color:#81c784;padding:2px 6px;border-radius:3px',
        );
        const { output, imageBase64 } = await this.callbacks.executeFunction(name, args);
        this.history.push({ role: 'tool', tool_name: name, content: JSON.stringify(output) });
        if (imageBase64) {
          this.history.push({
            role: 'user',
            content: 'Here is the image from that tool call.',
            images: [imageBase64],
          });
        }
      }
      this.trimHistory();
    }

    throw new Error(`Gave up after ${MAX_TOOL_ROUNDS} tool rounds without a final answer`);
  }

  private trimHistory(): void {
    // Trim from the front, but never split a tool exchange: drop leading
    // tool/assistant-with-calls messages until history starts at a user turn.
    while (this.history.length > MAX_HISTORY_MESSAGES) {
      this.history.shift();
      while (this.history.length > 0 && this.history[0].role !== 'user') {
        this.history.shift();
      }
    }
  }

  private async speak(text: string): Promise<void> {
    if (this.config.ttsEngine === 'voicebox') {
      try {
        await this.speakViaVoicebox(text);
        return;
      } catch (e) {
        this.callbacks.onError(
          `Voicebox TTS failed (${e instanceof Error ? e.message : String(e)}) — using system voice.`,
        );
      }
    }
    return this.speakViaSystem(text);
  }

  /**
   * Speak through the Voicebox app. /speak returns immediately and Voicebox
   * plays the audio itself, so we poll generation status and then hold the
   * mic gate for the audio's duration.
   */
  private async speakViaVoicebox(text: string): Promise<void> {
    const res = await fetch('/api/voicebox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, profile: this.config.voiceboxProfile || 'Jarvis' }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (!data.id) return;

    // Wait for generation to finish (poll), then for playback (duration).
    const deadline = Date.now() + 60_000;
    let duration = 0;
    while (Date.now() < deadline && !this.stopped) {
      await new Promise((r) => setTimeout(r, 350));
      try {
        const statusRes = await fetch(`/api/voicebox?generation=${encodeURIComponent(data.id)}`);
        const status = (await statusRes.json()) as { status?: string; duration?: number; error?: string | null };
        if (status.status === 'completed') {
          duration = status.duration ?? 0;
          break;
        }
        if (status.status === 'failed' || status.error) {
          throw new Error(status.error ?? 'generation failed');
        }
      } catch (e) {
        if (e instanceof Error && e.message !== 'Failed to fetch') throw e;
      }
    }
    if (!this.stopped && duration > 0) {
      await new Promise((r) => setTimeout(r, Math.min(duration * 1000 + 400, 60_000)));
    }
  }

  private speakViaSystem(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped) return resolve();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(this.config.voiceName);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.02;
      utterance.pitch = 0.9;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel(); // clear any stuck queue
      window.speechSynthesis.speak(utterance);
    });
  }
}
