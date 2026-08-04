'use client';

import { useCallback, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';
import { encodeWav, SpeechPlayer } from './audio';
import {
  buildSystemPrompt,
  capHistory,
  parseToolArgs,
  toChatTools,
  ChatMessage,
  ChatTool,
  ChatToolCall,
} from './chatTools';
import { emitError } from '@/frontend/lib/errorBus';
import type { JarvisFunction } from '@/frontend/lib/functions';

/**
 * Voicebox voice engine: Silero VAD (in-renderer) → whisper.cpp STT →
 * OpenAI Chat Completions with Jarvis tools → Voicebox TTS (the JARVIS
 * voice). Mirrors the surface of the ElevenLabs useConversation hook so
 * JarvisAssistant can drive either.
 */

const VAD_SAMPLE_RATE = 16_000;
const VAD_ASSET_PATH = '/vad/';
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY_MESSAGES = 40;
const MIN_TRANSCRIPT_CHARS = 2;
const TOOL_HANDLER_TIMEOUT_MS = 30_000;

export type LocalConversationStatus = 'disconnected' | 'connecting' | 'connected';

export interface LocalSessionOptions {
  /** OpenAI chat model, e.g. gpt-4o-mini. */
  model: string;
  initialPrompt: string;
  firstMessage?: string;
  voiceProfileId?: string;
  enabledFunctionNames: string[];
  /** Read at call time so dynamically loaded MCP/skill tools are included. */
  getFunctions: () => JarvisFunction[];
}

export interface LocalConversationCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
}

export interface LocalConversation {
  status: LocalConversationStatus;
  startSession: (options: LocalSessionOptions) => Promise<void>;
  endSession: () => void;
  setMuted: (muted: boolean) => void;
  getOutputVolume: () => number;
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
    emitError('local', message, 'error');
  }, []);

  const speak = useCallback(async (text: string): Promise<void> => {
    const player = playerRef.current;
    const options = optionsRef.current;
    if (!player || !options || !text.trim()) return;

    const sessionId = sessionIdRef.current;
    const speakToken = ++speakTokenRef.current;

    const res = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, profileId: options.voiceProfileId }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `Speech failed (${res.status})`);
    }
    const blob = await res.blob();

    // Discard stale audio: the session ended, the player was replaced, or a
    // newer turn started speaking while this response was in flight.
    if (
      sessionId !== sessionIdRef.current ||
      speakToken !== speakTokenRef.current ||
      playerRef.current !== player
    ) {
      return;
    }
    await player.play(blob);
  }, []);

  const runToolLoop = useCallback(async (): Promise<string> => {
    const options = optionsRef.current;
    if (!options) return '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      historyRef.current = capHistory(historyRef.current, MAX_HISTORY_MESSAGES);

      const res = await fetch('/api/voice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: historyRef.current,
          tools: toolsRef.current,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Chat request failed (${res.status})`);
      }

      const { message } = (await res.json()) as { message: ChatMessage };
      const toolCalls: ChatToolCall[] = message.tool_calls ?? [];

      if (toolCalls.length === 0) {
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: message.content ?? '' },
        ];
        return (message.content ?? '').trim();
      }

      // Record the assistant's tool request, then execute each call with the
      // same handlers the other engines use and feed results back.
      historyRef.current = [
        ...historyRef.current,
        { role: 'assistant', content: message.content ?? '', tool_calls: toolCalls },
      ];

      for (const call of toolCalls) {
        const name = call.function?.name ?? '';
        const fn = options.getFunctions().find((f) => f.name === name);
        let resultJson: string;

        if (!fn) {
          resultJson = JSON.stringify({ error: `Unknown function: ${name}` });
        } else {
          try {
            // A hung handler must not stall the loop forever — busyRef would
            // stay true and the mic would be dead for the rest of the session.
            const result = await Promise.race([
              Promise.resolve(fn.handler(parseToolArgs(call.function.arguments))),
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

    return 'I got stuck in a tool loop, sir. Could you rephrase the request?';
  }, []);

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
      if (!text || text.length < MIN_TRANSCRIPT_CHARS) return;

      historyRef.current = [...historyRef.current, { role: 'user', content: text }];
      const reply = await runToolLoop();
      if (sessionId !== sessionIdRef.current) return;

      // Speaking is interruptible: clear busy before playback so VAD speech
      // events (barge-in) are accepted while Jarvis talks.
      busyRef.current = false;
      if (reply) await speak(reply);
    } catch (err) {
      reportTurnError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sessionId === sessionIdRef.current) busyRef.current = false;
    }
  }, [runToolLoop, speak, reportTurnError]);

  const endSession = useCallback(() => {
    sessionIdRef.current += 1;
    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) void vad.destroy();
    playerRef.current?.destroy();
    playerRef.current = null;
    historyRef.current = [];
    optionsRef.current = null;
    toolsRef.current = [];
    busyRef.current = false;
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
      const health = (await (await fetch('/api/voice/chat')).json()) as {
        ok: boolean;
        error?: string;
      };
      if (!health.ok) throw new Error(health.error ?? 'The chat brain is not configured.');

      optionsRef.current = options;
      toolsRef.current = toChatTools(
        options.getFunctions().map((f) => f.tool),
        options.enabledFunctionNames,
      );

      // Warm whisper.cpp now (fire-and-forget) so the first real turn
      // doesn't pay the model-load cost.
      const warmupForm = new FormData();
      warmupForm.set('audio', encodeWav(new Float32Array(8000), VAD_SAMPLE_RATE), 'warmup.wav');
      void fetch('/api/voice/transcribe', { method: 'POST', body: warmupForm })
        .catch(() => undefined);
      historyRef.current = [
        { role: 'system', content: buildSystemPrompt(options.initialPrompt) },
      ];
      playerRef.current = new SpeechPlayer();

      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        startOnLoad: false,
        onSpeechStart: () => {
          // Barge-in: user talking over Jarvis stops playback immediately.
          if (playerRef.current?.isPlaying) playerRef.current.stop();
        },
        onSpeechEnd: (audio: Float32Array) => {
          if (mutedRef.current || busyRef.current) return;
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
        speak(options.firstMessage.trim()).catch((err) => {
          reportTurnError(err instanceof Error ? err.message : String(err));
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      endSession();
      callbacksRef.current.onError?.(message);
      throw err;
    }
  }, [endSession, processSpeechSegment, speak, reportTurnError]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    const vad = vadRef.current;
    if (!vad) return;
    if (muted) {
      void vad.pause();
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

  return { status, startSession, endSession, setMuted, getOutputVolume, sendContextualUpdate };
}
