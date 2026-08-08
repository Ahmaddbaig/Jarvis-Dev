'use client';

import { useCallback, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';
import { encodeWav, SpeechPlayer } from './audio';
import {
  buildSystemPrompt,
  capHistory,
  extractSpeakableChunks,
  isNoiseTranscript,
  parseToolArgs,
  toChatTools,
  ChatMessage,
  ChatTool,
  ChatToolCall,
  SentenceCoalescer,
} from './chatTools';
import { emitError } from '@/frontend/lib/errorBus';
import { resolveEnabledFunction } from '@/frontend/lib/dynamic-functions';
import type { JarvisFunction } from '@/frontend/lib/functions';

/**
 * Voicebox voice engine: Silero VAD (in-renderer) → whisper.cpp STT →
 * Claude, OpenAI, or local Ollama chat with Jarvis tools → Voicebox TTS
 * (the JARVIS voice). Mirrors the surface of the ElevenLabs useConversation
 * hook so JarvisAssistant can drive any provider through the same voice
 * profile.
 */

const VAD_SAMPLE_RATE = 16_000;
const VAD_ASSET_PATH = '/vad/';
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY_MESSAGES = 40;
const MIN_TRANSCRIPT_CHARS = 2;
const TOOL_HANDLER_TIMEOUT_MS = 30_000;

export type LocalConversationStatus = 'disconnected' | 'connecting' | 'connected';

export type BrainProvider = 'openai' | 'claude' | 'local';

export interface LocalSessionOptions {
  /** Brain provider for the chat model. */
  provider: BrainProvider;
  /** Chat model, e.g. gpt-4o-mini, claude-haiku-4-5, or qwen3.6:27b. */
  model: string;
  initialPrompt: string;
  firstMessage?: string;
  voiceProfileId?: string;
  /** Pitch-preserving playback speed for Voicebox speech. */
  playbackRate?: number;
  enabledFunctionNames: string[];
  /** Read at call time so dynamically loaded MCP/skill tools are included. */
  getFunctions: () => JarvisFunction[];
  /**
   * Runs a tool through capability policy. Returns the handler result, or an
   * `{ error }` object when policy refused it.
   */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface LocalConversationCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
  onMessage?: (message: { message: string; role: 'user' | 'assistant' }) => void;
  onModeChange?: (event: { mode: 'speaking' | 'listening' }) => void;
}

export interface LocalConversation {
  status: LocalConversationStatus;
  startSession: (options: LocalSessionOptions) => Promise<void>;
  endSession: () => void;
  setMuted: (muted: boolean) => void;
  getOutputVolume: () => number;
  sendUserMessage: (text: string) => Promise<void>;
  sendContextualUpdate: (text: string) => void;
}

export function useLocalConversation(
  callbacks: LocalConversationCallbacks = {},
): LocalConversation {
  const [status, setStatus] = useState<LocalConversationStatus>('disconnected');

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const vadRef = useRef<MicVAD | null>(null);
  const playerRef = useRef<SpeechPlayer | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const optionsRef = useRef<LocalSessionOptions | null>(null);
  const toolsRef = useRef<ChatTool[]>([]);
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  const sessionIdRef = useRef(0);
  // Monotonic token so a slow TTS response for an old turn is discarded
  // instead of playing over (or after) a newer one.
  const speakTokenRef = useRef(0);

  const reportTurnError = useCallback((message: string) => {
    emitError('voicebox', message, 'error');
  }, []);

  // Sentence-pipelined speech: TTS fetches run in order (Voicebox serves one
  // inference at a time) while playback of earlier sentences is under way, so
  // Jarvis starts talking after the FIRST sentence instead of after the full
  // reply is generated and synthesized.
  const ttsChainRef = useRef<Promise<void>>(Promise.resolve());
  const playChainRef = useRef<Promise<void>>(Promise.resolve());
  // Sentences accepted for synthesis but not yet finished playing.
  const pendingSpeechRef = useRef(0);
  // When the last synthesized chunk finished playing — mic segments that end
  // inside a short tail after playback are echo of Jarvis, not the user.
  const lastPlaybackEndRef = useRef(0);

  const enqueueSpeak = useCallback((text: string): void => {
    const trimmed = text.trim();
    const player = playerRef.current;
    const options = optionsRef.current;
    if (!player || !options || !trimmed) return;

    const sessionId = sessionIdRef.current;
    const speakToken = speakTokenRef.current;
    // Stale when the session ended, a barge-in/new turn superseded this
    // reply, or the player was replaced.
    const isStale = () =>
      sessionId !== sessionIdRef.current ||
      speakToken !== speakTokenRef.current ||
      playerRef.current !== player;

    const blobPromise: Promise<Blob | null> = ttsChainRef.current.then(async () => {
      if (isStale()) return null;
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, profileId: options.voiceProfileId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Speech failed (${res.status})`);
      }
      return res.blob();
    });
    ttsChainRef.current = blobPromise.then(
      () => undefined,
      () => undefined,
    );

    pendingSpeechRef.current += 1;
    playChainRef.current = playChainRef.current
      .then(async () => {
        const blob = await blobPromise;
        if (!blob || isStale()) return;
        callbacksRef.current.onModeChange?.({ mode: 'speaking' });
        await player.play(blob);
      })
      .catch((err) => {
        reportTurnError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        pendingSpeechRef.current = Math.max(0, pendingSpeechRef.current - 1);
        lastPlaybackEndRef.current = Date.now();
        if (pendingSpeechRef.current === 0) {
          callbacksRef.current.onModeChange?.({ mode: 'listening' });
        }
      });
  }, [reportTurnError]);

  /**
   * One chat round trip, reading the route's NDJSON stream. Text deltas are
   * spoken sentence-by-sentence as they arrive; the final message (with any
   * tool calls) resolves the promise.
   */
  const streamChatRound = useCallback(async (): Promise<ChatMessage> => {
    const options = optionsRef.current;
    if (!options) throw new Error('No active session');

    const res = await fetch('/api/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: options.provider,
        model: options.model,
        messages: historyRef.current,
        tools: toolsRef.current,
      }),
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `Chat request failed (${res.status})`);
    }

    let message: ChatMessage | null = null;
    let sentenceBuffer = '';
    let spokenText = '';
    // First sentence goes to TTS immediately; later ones are batched so
    // per-sentence generation gaps don't chop the reply into fragments.
    const coalescer = new SentenceCoalescer();
    const handleLine = (line: string) => {
      if (!line) return;
      let event: { t?: string; text?: string; message?: ChatMessage; error?: string };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.t === 'd' && event.text) {
        sentenceBuffer += event.text;
        const { chunks, rest } = extractSpeakableChunks(sentenceBuffer);
        sentenceBuffer = rest;
        for (const chunk of chunks) {
          const speakable = coalescer.push(chunk);
          if (speakable) {
            enqueueSpeak(speakable);
            spokenText += (spokenText ? ' ' : '') + speakable;
          }
        }
      } else if (event.t === 'm' && event.message) {
        message = event.message;
      } else if (event.t === 'e') {
        throw new Error(event.error ?? 'Chat request failed.');
      }
    };

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) handleLine(line.trim());
      }
      if (buffer.trim()) handleLine(buffer.trim());
    } catch (err) {
      // Anything already spoken aloud must survive in history, or the next
      // turn's model has no memory of what the user just heard.
      if (spokenText) {
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: `${spokenText} (reply interrupted by an error)` },
        ];
      }
      throw err;
    }

    if (!message) throw new Error('Chat stream ended without a message.');
    // Drain the batch plus the tail of the reply (usually unpunctuated).
    const finalChunk = coalescer.flush(sentenceBuffer);
    if (finalChunk) enqueueSpeak(finalChunk);
    return message;
  }, [enqueueSpeak]);

  /** Runs chat rounds, executing tool calls until the model answers in text. */
  const runToolLoop = useCallback(async (): Promise<void> => {
    const options = optionsRef.current;
    if (!options) return;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      historyRef.current = capHistory(historyRef.current, MAX_HISTORY_MESSAGES);

      const message = await streamChatRound();
      const toolCalls: ChatToolCall[] = message.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const reply = (message.content ?? '').trim();
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: reply },
        ];
        if (reply) callbacksRef.current.onMessage?.({ message: reply, role: 'assistant' });
        return; // already spoken via the streaming sentence queue
      }

      // Record the assistant's tool request, then execute each call with the
      // same handlers the other engines use and feed results back.
      historyRef.current = [
        ...historyRef.current,
        { role: 'assistant', content: message.content ?? '', tool_calls: toolCalls },
      ];

      for (const call of toolCalls) {
        const name = call.function?.name ?? '';
        const fn = resolveEnabledFunction(name, options.getFunctions(), new Set(options.enabledFunctionNames));
        let resultJson: string;

        if (!fn) {
          resultJson = JSON.stringify({ error: `Unknown function: ${name}` });
        } else {
          try {
            // A hung handler must not stall the loop forever — busyRef would
            // stay true and the mic would be dead for the rest of the session.
            const result = await Promise.race([
              options.executeTool(name, parseToolArgs(call.function.arguments)),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`${name}() timed out after ${TOOL_HANDLER_TIMEOUT_MS / 1000}s`)),
                  TOOL_HANDLER_TIMEOUT_MS,
                ),
              ),
            ]);
            const resultObj = (result ?? {}) as Record<string, unknown>;
            if (typeof resultObj.error === 'string') {
              emitError('function', `${name}(): ${resultObj.error}`, 'error');
            }
            // Vision payloads are dropped: this text-only chat loop sends
            // string content, so images cannot be forwarded.
            const { imageBase64: _imageBase64, ...textResult } = resultObj;
            resultJson = JSON.stringify(textResult);
          } catch (err) {
            resultJson = JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        historyRef.current = [
          ...historyRef.current,
          { role: 'tool', tool_call_id: call.id, content: resultJson },
        ];
      }
    }

    const fallback = 'I got stuck in a tool loop, sir. Could you rephrase the request?';
    historyRef.current = [...historyRef.current, { role: 'assistant', content: fallback }];
    callbacksRef.current.onMessage?.({ message: fallback, role: 'assistant' });
    enqueueSpeak(fallback);
  }, [streamChatRound, enqueueSpeak]);

  const processSpeechSegment = useCallback(async (audio: Float32Array): Promise<void> => {
    const sessionId = sessionIdRef.current;
    busyRef.current = true;
    try {
      const wav = encodeWav(audio, VAD_SAMPLE_RATE);
      const form = new FormData();
      form.set('audio', wav, 'speech.wav');

      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Transcription failed (${res.status})`);
      }
      const { text } = (await res.json()) as { text: string };
      if (sessionId !== sessionIdRef.current) return;
      const transcript = (text ?? '').trim();
      // Noise blips and whisper hallucinations must not become user turns.
      if (transcript.length < MIN_TRANSCRIPT_CHARS || isNoiseTranscript(transcript)) return;

      // A validated user turn supersedes anything still queued or playing.
      speakTokenRef.current += 1;
      playerRef.current?.stop();
      historyRef.current = [...historyRef.current, { role: 'user', content: transcript }];
      callbacksRef.current.onMessage?.({ message: transcript, role: 'user' });
      // Speech is pipelined inside the loop; playback continues after this
      // resolves, and busyRef clears below so barge-in speech is accepted
      // while Jarvis is still talking.
      await runToolLoop();
    } catch (err) {
      reportTurnError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sessionId === sessionIdRef.current) busyRef.current = false;
    }
  }, [runToolLoop, reportTurnError]);

  const sendUserMessage = useCallback(async (rawText: string): Promise<void> => {
    const text = rawText.trim();
    if (!text) return;
    if (!optionsRef.current) throw new Error('Start Jarvis before sending a message.');
    if (busyRef.current) throw new Error('Jarvis is still finishing the previous request.');

    const sessionId = sessionIdRef.current;
    busyRef.current = true;
    speakTokenRef.current += 1;
    playerRef.current?.stop();
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    callbacksRef.current.onMessage?.({ message: text, role: 'user' });
    try {
      // The provider changes only the chat brain. Speech always runs through
      // /api/voice/speak with the session's selected Voicebox profile, so the
      // cloned voice stays identical for Claude and OpenAI.
      await runToolLoop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reportTurnError(message);
      throw err;
    } finally {
      if (sessionId === sessionIdRef.current) busyRef.current = false;
    }
  }, [runToolLoop, reportTurnError]);

  const endSession = useCallback(() => {
    sessionIdRef.current += 1;
    speakTokenRef.current += 1;
    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) void vad.destroy();
    if (playerRef.current?.isPlaying || pendingSpeechRef.current > 0) {
      callbacksRef.current.onModeChange?.({ mode: 'listening' });
    }
    playerRef.current?.destroy();
    playerRef.current = null;
    ttsChainRef.current = Promise.resolve();
    playChainRef.current = Promise.resolve();
    historyRef.current = [];
    optionsRef.current = null;
    toolsRef.current = [];
    busyRef.current = false;
    pendingSpeechRef.current = 0;
    setStatus((prev) => {
      if (prev !== 'disconnected') callbacksRef.current.onDisconnect?.();
      return 'disconnected';
    });
  }, []);

  const startSession = useCallback(async (options: LocalSessionOptions): Promise<void> => {
    endSession();
    const sessionId = sessionIdRef.current;
    setStatus('connecting');

    try {
      // Fail fast with a useful message if no API key is configured.
      const health = (await (
        await fetch(`/api/voice/chat?provider=${options.provider}`)
      ).json()) as {
        ok: boolean;
        error?: string;
      };
      if (!health.ok) throw new Error(health.error ?? 'The chat brain is not configured.');

      optionsRef.current = options;
      toolsRef.current = toChatTools(
        options.getFunctions().map((f) => f.tool),
        options.enabledFunctionNames,
      );

      // Warm every cold path now (fire-and-forget) so the first real turn
      // doesn't pay model-load costs: whisper.cpp for STT, and the Voicebox
      // TTS engine, whose cold load takes ~40s for the cloned JARVIS voice.
      const warmupForm = new FormData();
      warmupForm.set('audio', encodeWav(new Float32Array(8000), VAD_SAMPLE_RATE), 'warmup.wav');
      void fetch('/api/voice/transcribe', { method: 'POST', body: warmupForm })
        .catch(() => undefined);
      void fetch('/api/voice/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: options.voiceProfileId }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) {
            emitError('voicebox', data?.error ?? 'Voice engine warmup failed.', 'warn');
          }
        })
        .catch(() => undefined);
      historyRef.current = [
        { role: 'system', content: buildSystemPrompt(options.initialPrompt) },
      ];
      playerRef.current = new SpeechPlayer(options.playbackRate);

      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        startOnLoad: false,
        onSpeechEnd: (audio: Float32Array) => {
          if (mutedRef.current || busyRef.current) return;
          // The mic inevitably hears Jarvis through the speakers. While he
          // is talking — or within a short tail after he stops — segments
          // are his own echo, not the user: drop them unheard. This trades
          // voice barge-in for glitch-free, cutout-free playback; the mute
          // button still interrupts instantly.
          const ECHO_TAIL_MS = 350;
          if (
            playerRef.current?.isPlaying ||
            pendingSpeechRef.current > 0 ||
            Date.now() - lastPlaybackEndRef.current < ECHO_TAIL_MS
          ) {
            return;
          }
          void processSpeechSegment(audio);
        },
      });
      if (sessionId !== sessionIdRef.current) {
        void vad.destroy();
        return;
      }
      vadRef.current = vad;
      if (!mutedRef.current) await vad.start();

      setStatus('connected');
      callbacksRef.current.onConnect?.();

      if (options.firstMessage?.trim()) {
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: options.firstMessage.trim() },
        ];
        enqueueSpeak(options.firstMessage.trim());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      endSession();
      callbacksRef.current.onError?.(message);
      throw err;
    }
  }, [endSession, processSpeechSegment, enqueueSpeak, reportTurnError]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    const vad = vadRef.current;
    if (!vad) return;
    if (muted) {
      void vad.pause();
      speakTokenRef.current += 1; // discard queued sentences too
      playerRef.current?.stop();
    } else {
      void vad.start();
    }
  }, []);

  const getOutputVolume = useCallback((): number => {
    return playerRef.current?.getOutputVolume() ?? 0;
  }, []);

  const sendContextualUpdate = useCallback((text: string) => {
    if (!optionsRef.current || !text.trim()) return;
    historyRef.current = [...historyRef.current, { role: 'system', content: text.trim() }];
  }, []);

  return {
    status,
    startSession,
    endSession,
    setMuted,
    getOutputVolume,
    sendUserMessage,
    sendContextualUpdate,
  };
}
