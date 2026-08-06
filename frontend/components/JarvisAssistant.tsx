'use client';

import { useEffect, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { SettingsModal, type JarvisSettingsDraft } from './SettingsModal';
import {
  jarvisSettingsPatchSchema,
  jarvisSettingsSchema,
  type CredentialPatch,
  type JarvisSettings,
} from '@jarvis/contracts';
import { FUNCTION_REGISTRY, getFunctionByName, JarvisFunction } from '@/frontend/lib/functions';
import { createGetFunctionByName, resolveEnabledFunction } from '@/frontend/lib/dynamic-functions';
import { XrayWidget } from './XrayWidget';
import { CameraWidget } from './CameraWidget';
import { ArcReactorVisualizer } from './visualizers/ArcReactorVisualizer';
import { SphereNodesVisualizer } from './visualizers/SphereNodesVisualizer';
import { QuarterRingsVisualizer } from './visualizers/QuarterRingsVisualizer';
import { OriginalVisualizer } from './visualizers/OriginalVisualizer';
import { PhotoWidget, PhotoEntry } from './PhotoWidget';
import { sfx } from '@/frontend/lib/sfx';
import { installErrorInterceptors, emitError } from '@/frontend/lib/errorBus';
import { useSaveServerSettings, useServerSettings } from '@/frontend/hooks/queries/useServerSettings';
import { useSaveCredentials } from '@/frontend/hooks/queries/useCredentials';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';
import { useLocalConversation } from '@/frontend/lib/localVoice/useLocalConversation';
import {
  useVisualizerAudio,
  VISUALIZER_FFT_BARS,
} from '@/frontend/hooks/useVisualizerAudio';
import { useJarvisVoice } from '@/frontend/hooks/useJarvisVoice';
import { useDynamicFunctions } from '@/frontend/hooks/queries/useDynamicFunctions';
import { useQueryClient } from '@tanstack/react-query';
import { nowPlayingQueryOptions } from '@/frontend/hooks/queries/useMusic';
import { queryKeys } from '@/frontend/lib/query/keys';
import {
  DEFAULT_LOCAL_AI_BASE_URL,
  getLocalAIProfile,
  normalizeLocalAIBaseUrl,
} from '@/frontend/lib/localAIProfiles';
import {
  hasUsableVoiceEngineConfig,
  migrateLegacyVoiceboxMode,
} from '@/frontend/lib/voiceEngineMode';
import {
  acquireMicrophone,
  buildAssistantInstructions,
  buildTranscriptionPrompt,
  createLocalAIRealtimeAdapter,
  createOpenAIRealtimeAdapter,
  probeMicrophonePermission,
  hasJarvisWakeWord,
  releaseRealtimeTransport,
  setMicrophoneStreamMuted,
} from '@/frontend/lib/voiceSession';

// Keep speaker bleed and song vocals below the activation point while still
// allowing a nearby user speaking clearly to interrupt playback.
const MUSIC_PLAYBACK_RESTORE_FALLBACK_MS = 10_000;
const MAX_CHAT_MESSAGES = 24;
const REALTIME_TEXT_DELTA_EVENTS = new Set([
  'response.output_audio_transcript.delta',
  'response.audio_transcript.delta',
  'response.output_text.delta',
  'response.text.delta',
]);
const REALTIME_TEXT_DONE_EVENTS = new Set([
  'response.output_audio_transcript.done',
  'response.audio_transcript.done',
  'response.output_text.done',
  'response.text.done',
]);
// Brain for the Voicebox engine — per-provider defaults, swappable in Settings.
// Haiku is the default Claude brain: spoken replies need sub-second first
// tokens, and the reasoning-tier models think for seconds before speaking.
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_CLAUDE_CHAT_MODEL = 'claude-haiku-4-5';

const DEFAULT_SETTINGS: JarvisSettings = {
  schemaVersion: 1,
  apiMode: 'openai',
  localAIProfile: 'm5',
  localAIBaseUrl: DEFAULT_LOCAL_AI_BASE_URL,
  microphoneDeviceId: '',
  speechVocabulary: '',
  elevenLabsAgentId: '',
  elevenLabsFirstMessage: '',
  brainProvider: 'openai',
  chatModel: DEFAULT_OPENAI_CHAT_MODEL,
  voicePlaybackRate: 0.8,
  voice: 'echo',
  initialPrompt: 'You are Jarvis, a helpful AI assistant. You are always helpful, polite, and concise. Subtle British accent. Robotic. Emotionally controlled. Witty and a little bit poking fun at the user.',
  enabledFunctions: ['desktop_mode', 'navigate_to_page', 'jarvis_disconnect', 'play_spotify'],
  theme: 'arc-reactor',
  grid: 'off',
  visualizer: 'frequency-ring',
  logo: 'logo',
  position: 'center',
  shellPathOverride: '',
  pythonPathOverride: '',
};

function withoutCredentialValues(settings: JarvisSettingsDraft): JarvisSettings {
  const safe = { ...settings };
  delete safe.apiKey;
  delete safe.claudeApiKey;
  return safe;
}

type DesktopPanelPosition = Exclude<JarvisSettings['position'], 'center'>;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ChatPanelProps = {
  messages: ChatMessage[];
  value: string;
  online: boolean;
  sending: boolean;
  micMuted: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSend: () => void;
  onToggleMic: () => void;
};

function ChatPanel({
  messages,
  value,
  online,
  sending,
  micMuted,
  error,
  onChange,
  onSend,
  onToggleMic,
}: ChatPanelProps) {
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [messages]);

  return (
    <section
      aria-label="Jarvis text chat"
      className="fixed z-[80] bottom-5 left-1/2 -translate-x-1/2 w-[min(92vw,720px)] pointer-events-auto select-text"
    >
      {messages.length > 0 && (
        <div
          ref={historyRef}
          aria-live="polite"
          className="mb-2 max-h-44 overflow-y-auto rounded-xl border border-cyan-500/30 bg-black/85 px-4 py-3 shadow-[0_0_24px_rgba(var(--accent-rgb),0.16)] backdrop-blur-md"
        >
          <div className="space-y-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 text-sm leading-relaxed ${message.role === 'user' ? 'text-white/85' : 'text-cyan-300'}`}
              >
                <span className="w-14 shrink-0 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-500/70">
                  {message.role === 'user' ? 'You' : 'Jarvis'}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        className="flex items-end gap-2 rounded-xl border border-cyan-500/50 bg-black/90 p-2 shadow-[0_0_28px_rgba(var(--accent-rgb),0.2)] backdrop-blur-md"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <button
          type="button"
          onClick={onToggleMic}
          aria-label={micMuted ? 'Turn microphone on' : 'Mute microphone while typing'}
          aria-pressed={micMuted}
          className={`h-10 shrink-0 rounded-lg border px-3 font-mono text-[10px] font-bold uppercase tracking-widest transition-colors ${
            micMuted
              ? 'border-red-500/60 bg-red-950/50 text-red-300'
              : 'border-cyan-500/30 bg-cyan-950/20 text-cyan-400 hover:border-cyan-400'
          }`}
        >
          {micMuted ? 'Mic off' : 'Mic on'}
        </button>

        <textarea
          value={value}
          rows={1}
          maxLength={4000}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={online ? 'Type to Jarvis — the response will be spoken aloud' : 'Start Jarvis, then type a message'}
          aria-label="Message Jarvis"
          className="min-h-10 max-h-28 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-white outline-none placeholder:text-white/35"
        />

        <button
          type="submit"
          disabled={sending || !value.trim()}
          className="h-10 shrink-0 rounded-lg border border-cyan-400/70 bg-cyan-500/20 px-4 text-xs font-bold uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </form>

      <div className="mt-1 flex min-h-4 items-center justify-between px-2 font-mono text-[10px] uppercase tracking-wider">
        <span className={online ? 'text-emerald-400/70' : 'text-white/35'}>
          {online ? 'Text link ready · voice reply enabled' : 'Jarvis is offline'}
        </span>
        {error && <span className="ml-3 normal-case text-red-400">{error}</span>}
      </div>
    </section>
  );
}

function isDesktopPanelPosition(value: unknown): value is DesktopPanelPosition {
  return (
    value === 'top-left' ||
    value === 'top-right' ||
    value === 'bottom-left' ||
    value === 'bottom-right'
  );
}

export function JarvisAssistant({ compact = false }: { compact?: boolean }) {
  const voiceSession = useJarvisVoice();
  const serverSettingsQuery = useServerSettings();
  const { mutate: saveSettingsToServer, mutateAsync: saveSettingsToServerAsync } = useSaveServerSettings();
  const { mutateAsync: saveCredentials } = useSaveCredentials();
  const dynamicFunctionsQuery = useDynamicFunctions();
  const queryClient = useQueryClient();
  const { status, lastError, micMuted } = voiceSession;
  const [chatText, setChatText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const statusRef = useRef(status);
  const micMutedRef = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [ring1Rotation, setRing1Rotation] = useState(0);
  const [ring2Rotation, setRing2Rotation] = useState(0);
  const rotationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  // When true, an unexpected WebRTC drop will schedule an auto-reconnect.
  // Set false during intentional disconnect so we don't loop.
  const autoReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp (ms) when the current session became active. Used to block
  // automatic navigate_to_page calls in the first few seconds after a
  // session auto-reconnects, which prevents the model from navigating the
  // user back to "home" as part of its unsolicited greeting.
  const sessionStartTimeRef = useRef<number>(0);
  const realtimeResponseTextRef = useRef<Map<string, string>>(new Map());
  const completedRealtimeResponsesRef = useRef<Set<string>>(new Set());
  const musicDuckRef = useRef<{
    active: boolean;
    previousVolume: number | null;
    app: 'Spotify' | 'Music' | null;
  }>({
    active: false,
    previousVolume: null,
    app: null,
  });
  const musicDuckRequestRef = useRef<Promise<void> | null>(null);
  const musicRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function releaseRealtimeResources(): void {
    const errors = releaseRealtimeTransport({
      peerConnection: peerConnectionRef,
      dataChannel: dataChannelRef,
      remoteStream: remoteStreamRef,
      localStream: localAudioStreamRef,
      remoteAudio: remoteAudioRef,
    });
    if (errors.length > 0) console.warn('[Jarvis] Realtime resource cleanup had errors:', errors);
  }

  function appendChatMessage(role: ChatMessage['role'], rawText: string): void {
    const text = rawText.trim();
    if (!text) return;

    setChatMessages((current) => {
      const previous = current[current.length - 1];
      if (previous?.role === role && previous.text === text) return current;
      return [...current, { id: crypto.randomUUID(), role, text }].slice(-MAX_CHAT_MESSAGES);
    });
  }

  function realtimeResponseKey(data: Record<string, unknown>): string {
    const response = data.response as { id?: unknown } | undefined;
    return String(data.response_id ?? response?.id ?? data.item_id ?? 'current-response');
  }

  function completeRealtimeResponse(responseKey: string, finalText?: string): void {
    if (completedRealtimeResponsesRef.current.has(responseKey)) return;
    const text = (finalText || realtimeResponseTextRef.current.get(responseKey) || '').trim();
    if (!text) return;

    completedRealtimeResponsesRef.current.add(responseKey);
    realtimeResponseTextRef.current.delete(responseKey);
    appendChatMessage('assistant', text);
  }

  // Dynamic function state — starts unloaded; gates auto-start.
  const dynamicState = dynamicFunctionsQuery.data ?? {
    allFunctions: FUNCTION_REGISTRY,
    mcpFunctions: [],
    skillFunctions: [],
    loaded: false,
    loadError: null,
  };
  const dynamicGetFunctionByNameRef = useRef<(name: string) => JarvisFunction | undefined>(getFunctionByName);
  const allFunctionsRef = useRef<readonly JarvisFunction[]>(FUNCTION_REGISTRY);
  const enabledFunctionNamesRef = useRef<ReadonlySet<string>>(new Set(DEFAULT_SETTINGS.enabledFunctions));

  // Resolves a model-requested tool against the *enabled* set. Reads through
  // refs so a toggle mid-session takes effect immediately.
  function resolveCallableFunction(name: string): JarvisFunction | undefined {
    return resolveEnabledFunction(name, allFunctionsRef.current, enabledFunctionNamesRef.current);
  }

  // Ref-based ElevenLabs clientTools so dynamic functions are included at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elClientToolsRef = useRef<Record<string, (params: any) => any>>(
    Object.fromEntries(
      FUNCTION_REGISTRY.map((fn) => [
        fn.name,
        async (params: Record<string, unknown>) => {
          const result = await fn.handler(params);
          if (fn.name === 'play_spotify') {
            scheduleMusicRestore(MUSIC_PLAYBACK_RESTORE_FALLBACK_MS);
          }
          const r = result as Record<string, unknown> | null;
          if (typeof r?.error === 'string') {
            emitError('function', `${fn.name}(): ${r.error}`, 'error');
          }
          return result;
        },
      ]),
    ),
  );

  // ElevenLabs Conversational AI hook
  // NOTE: Do NOT pass micMuted here — changing it causes the SDK to reinitialize
  // the mic, which looks like a restart. Muting is handled imperatively via
  // elConversation.setMuted() in setMicrophoneMuted() instead.
  const elConversation = useConversation({
    clientTools: elClientToolsRef.current,
    onConnect: () => {
      console.log('ElevenLabs connected');
      setChatError(null);
      voiceSession.connected();
    },
    onDisconnect: (details?: { reason?: string; code?: number; message?: string }) => {
      void restoreMusicVolume();
      const reason = details?.message ?? details?.reason ?? (details?.code != null ? `code ${details.code}` : null);
      console.log('ElevenLabs disconnected', details ?? '');
      if (reason && statusRef.current !== 'idle') {
        voiceSession.fail(`Disconnected: ${reason}`);
        emitError('elevenlabs', `Disconnected: ${reason}`);
      } else if (statusRef.current !== 'idle') {
        voiceSession.disconnected();
      }
    },
    onError: (error) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = error as any;
      const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : JSON.stringify(e));
      console.error('ElevenLabs error:', error);
      voiceSession.fail(msg);
      emitError('elevenlabs', msg);
    },
    onMessage: ({ message, role }) => {
      appendChatMessage(role === 'agent' ? 'assistant' : 'user', message);
    },
    onModeChange: ({ mode }) => {
      if (mode === 'speaking') {
        voiceSession.speaking();
        void duckMusic();
      } else {
        voiceSession.listening();
        scheduleMusicRestore(500);
      }
    },
    onInterruption: () => {
      voiceSession.listening();
      void duckMusic();
    },
  });

  async function duckMusic(): Promise<void> {
    if (musicRestoreTimerRef.current) {
      clearTimeout(musicRestoreTimerRef.current);
      musicRestoreTimerRef.current = null;
    }
    if (musicDuckRef.current.active || musicDuckRequestRef.current) return;

    musicDuckRef.current.active = true;
    const request = (async () => {
      try {
        const res = await fetch('/api/music', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'duck', value: 18 }),
        });
        const data = await res.json() as {
          error?: string;
          ducked?: boolean;
          previousVolume?: number | null;
          app?: 'Spotify' | 'Music';
        };
        if (!res.ok || data.error || !data.ducked) {
          musicDuckRef.current = { active: false, previousVolume: null, app: null };
          return;
        }
        musicDuckRef.current.previousVolume =
          typeof data.previousVolume === 'number' ? data.previousVolume : null;
        musicDuckRef.current.app = data.app ?? null;
        void queryClient.invalidateQueries({ queryKey: queryKeys.music.all });
        // Failsafe in case a provider disconnects without an audio-finished event.
        scheduleMusicRestore(30_000);
      } catch {
        musicDuckRef.current = { active: false, previousVolume: null, app: null };
      }
    })();

    musicDuckRequestRef.current = request;
    await request;
    musicDuckRequestRef.current = null;
  }

  function scheduleMusicRestore(delayMs = 350): void {
    if (musicRestoreTimerRef.current) clearTimeout(musicRestoreTimerRef.current);
    musicRestoreTimerRef.current = setTimeout(() => {
      musicRestoreTimerRef.current = null;
      void restoreMusicVolume();
    }, delayMs);
  }

  async function restoreMusicVolume(): Promise<void> {
    if (musicRestoreTimerRef.current) {
      clearTimeout(musicRestoreTimerRef.current);
      musicRestoreTimerRef.current = null;
    }
    if (musicDuckRequestRef.current) await musicDuckRequestRef.current;
    if (musicRestoreTimerRef.current) {
      clearTimeout(musicRestoreTimerRef.current);
      musicRestoreTimerRef.current = null;
    }

    const previousVolume = musicDuckRef.current.previousVolume;
    const duckedApp = musicDuckRef.current.app;
    const wasActive = musicDuckRef.current.active;
    musicDuckRef.current = { active: false, previousVolume: null, app: null };
    if (!wasActive || previousVolume === null || duckedApp === null) return;

    try {
      await fetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'volume', value: previousVolume, app: duckedApp }),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.music.all });
    } catch {
      // The failsafe is best-effort; a later manual volume change remains available.
    }
  }

  // Voicebox voice engine — Claude or OpenAI brain + one shared Voicebox voice
  const voiceboxConversation = useLocalConversation({
    onConnect: voiceSession.connected,
    onDisconnect: () => {
      void restoreMusicVolume();
      if (statusRef.current !== 'idle') voiceSession.disconnected();
    },
    onError: (message) => {
      voiceSession.fail(message);
      emitError('voicebox', message);
    },
    onMessage: ({ message, role }) => appendChatMessage(role, message),
    onModeChange: ({ mode }) => {
      if (mode === 'speaking') {
        voiceSession.speaking();
        void duckMusic();
      } else {
        voiceSession.listening();
        scheduleMusicRestore(500);
      }
    },
  });

  // Photo context state
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const photosRef = useRef<PhotoEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<JarvisSettings>(DEFAULT_SETTINGS);
  const [restartTrigger, setRestartTrigger] = useState(0);
  const [mounted, setMounted] = useState(false);
  const legacyCredentialMigrationStartedRef = useRef(false);
  const desktopModeRef = useRef(false);
  const desktopPanelPositionRef = useRef<DesktopPanelPosition>('bottom-right');
  const normalPositionBeforeDesktopRef = useRef<JarvisSettings['position'] | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // One-time renderer migration. Plaintext is removed only after each value is
  // already present in the OS vault or a vault write succeeds.
  useEffect(() => {
    if (!serverSettingsQuery.isSuccess || legacyCredentialMigrationStartedRef.current) return;
    if (window.electron?.isElectron !== true) return;

    const configured = serverSettingsQuery.data?.credentialStatus;
    let parsed: Record<string, unknown> = {};
    try {
      const candidate = JSON.parse(localStorage.getItem('jarvis_settings') ?? '{}') as unknown;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch { /* invalid legacy settings are ignored */ }

    const patch: CredentialPatch = {};
    const openai = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const anthropic = typeof parsed.claudeApiKey === 'string' ? parsed.claudeApiKey.trim() : '';
    const homeAssistant = localStorage.getItem('jarvis_ha_token')?.trim() ?? '';
    const ical = localStorage.getItem('jarvis_ical_url')?.trim() ?? '';
    if (openai && !configured?.openaiApiKey) patch.openaiApiKey = openai;
    if (anthropic && !configured?.anthropicApiKey) patch.anthropicApiKey = anthropic;
    if (homeAssistant && !configured?.homeAssistantToken) patch.homeAssistantToken = homeAssistant;
    if (ical && !configured?.icalFeedUrl) patch.icalFeedUrl = ical;

    const hasLegacyPlaintext = Boolean(openai || anthropic || homeAssistant || ical);
    if (!hasLegacyPlaintext) return;
    legacyCredentialMigrationStartedRef.current = true;

    void (async () => {
      try {
        if (Object.keys(patch).length > 0) await saveCredentials(patch);
        // Non-secret settings were imported by fetchServerSettings before this
        // credential cleanup runs, so the legacy document can now be removed.
        localStorage.removeItem('jarvis_settings');
        localStorage.removeItem('jarvis_ha_token');
        localStorage.removeItem('jarvis_ical_url');
      } catch (error) {
        legacyCredentialMigrationStartedRef.current = false;
        emitError('app', error instanceof Error ? error.message : String(error));
      }
    })();
  }, [saveCredentials, serverSettingsQuery.data, serverSettingsQuery.isSuccess]);

  // Install global error interceptors once so all console.error calls,
  // uncaught JS errors, and unhandled rejections stream to TerminalWidget.
  useEffect(() => { installErrorInterceptors(); }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  useEffect(() => {
    const unsubscribe = window.electron?.onDesktopOverlayClick?.(() => {
      sfx('click', 0.45);
      setMicrophoneMuted(!micMutedRef.current);
    });

    return () => unsubscribe?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        action?: 'enable' | 'disable' | 'move';
        position?: DesktopPanelPosition;
      }>).detail ?? {};
      const action = detail.action;
      const requestedPosition = isDesktopPanelPosition(detail.position)
        ? detail.position
        : undefined;

      if (!action) return;

      if (action === 'enable') {
        const position = requestedPosition ?? desktopPanelPositionRef.current;
        desktopPanelPositionRef.current = position;
        if (!desktopModeRef.current) {
          normalPositionBeforeDesktopRef.current = settings.position ?? 'center';
        }
        desktopModeRef.current = true;
        if (!window.electron?.isElectron) return;
        void window.electron.setDesktopMode({
          enabled: true,
          position,
          logo: settings.logo ?? 'logo',
          muted: micMutedRef.current,
        });
        return;
      }

      if (action === 'disable') {
        const savedNormalPosition = normalPositionBeforeDesktopRef.current;
        const restorePosition =
          savedNormalPosition && savedNormalPosition !== desktopPanelPositionRef.current
            ? savedNormalPosition
            : 'center';
        desktopModeRef.current = false;
        normalPositionBeforeDesktopRef.current = null;
        const updated = { ...settings, position: restorePosition };
        setSettings(updated);
        saveSettingsToServer({ jarvis_settings: JSON.stringify(updated) });
        if (!window.electron?.isElectron) return;
        void window.electron.setDesktopMode({ enabled: false });
        return;
      }

      const position = requestedPosition ?? desktopPanelPositionRef.current;
      desktopPanelPositionRef.current = position;
      if (!desktopModeRef.current) {
        const updated = { ...settings, position };
        setSettings(updated);
        saveSettingsToServer({ jarvis_settings: JSON.stringify(updated) });
      }
      if (!window.electron?.isElectron) return;
      void window.electron.moveDesktopPanel(position);
    };

    window.addEventListener('jarvis:desktop-mode', handler);
    return () => window.removeEventListener('jarvis:desktop-mode', handler);
  }, [saveSettingsToServer, settings]);

  // jarvis:self-disconnect — fired by jarvis_disconnect function tool
  useEffect(() => {
    const handler = () => {
      // Small delay so the function-call result can be sent over the data channel first
      setTimeout(() => disconnect(), 600);
    };
    window.addEventListener('jarvis:self-disconnect', handler);
    return () => window.removeEventListener('jarvis:self-disconnect', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status-change sound effects
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;

    if (status === 'error')     sfx('error', 0.8);
    if (status === 'idle' && prev !== 'idle') sfx('app_close', 0.6);
  }, [status]);

  // Keep photosRef in sync so the Realtime API injection always sees the latest list
  useEffect(() => {
    photosRef.current = photos;
    injectPhotosIntoSession(photos);

    // Expose current photo context so local tool handlers can reuse on-screen images.
    (window as Window & {
      __jarvisPhotoContext?: { latestDataUrl?: string; photos: string[] };
    }).__jarvisPhotoContext = {
      latestDataUrl: photos.length > 0 ? photos[photos.length - 1].dataUrl : undefined,
      photos: photos.map((p) => p.dataUrl),
    };
  }, [photos]);

  // Compress a dropped image file to a JPEG data URL (max 1024px)
  function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.onerror = reject;
        img.onload = () => {
          const MAX = 1024;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else       { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx2d = canvas.getContext('2d')!;
          ctx2d.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    files.forEach(async (file) => {
      try {
        const dataUrl = await compressImage(file);
        const entry: PhotoEntry = { id: crypto.randomUUID(), dataUrl, name: file.name };
        setPhotos(prev => [...prev, entry]);
      } catch (err) {
        console.error('Failed to load image', err);
      }
    });
  }

  function dismissPhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }

  // Send current photos as a conversation item so Jarvis has them in context.
  // Called whenever the photo list changes (if session is live) and on session open.
  function injectPhotosIntoSession(currentPhotos: PhotoEntry[]) {
    if (currentPhotos.length === 0) return;

    // Local path — text-only contextual update (local text model has no vision)
    if (voiceboxConversation.status === 'connected') {
      voiceboxConversation.sendContextualUpdate(
        `The user currently has ${currentPhotos.length} image${currentPhotos.length > 1 ? 's' : ''} on screen for visual context.`,
      );
      return;
    }

    // ElevenLabs path — send text-only contextual update (no vision support via client SDK)
    if (elConversation.status === 'connected') {
      Promise.resolve(
        elConversation.sendContextualUpdate(
          `The user currently has ${currentPhotos.length} image${currentPhotos.length > 1 ? 's' : ''} on screen for visual context.`,
        ),
      ).catch(() => {});
      return;
    }

    // OpenAI Realtime path
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') return;

    const content: unknown[] = [
      {
        type: 'input_text',
        text: `The user currently has ${currentPhotos.length} image${currentPhotos.length > 1 ? 's' : ''} on screen. Reference them if they are relevant to the conversation.`,
      },
      ...currentPhotos.map(p => ({
        type: 'input_image',
        image_url: p.dataUrl,
      })),
    ];

    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content },
    }));
  }

  /** Append plain text from a HUD paste into the realtime conversation so the model sees it. */
  function injectPastedHudTextIntoSession(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    // Local path
    if (voiceboxConversation.status === 'connected') {
      voiceboxConversation.sendContextualUpdate(
        'The user pasted the following text onto the HUD (it also appears in a TEXT NOTE widget). Treat it as context for what they want to discuss:\n\n' + trimmed,
      );
      return;
    }

    // ElevenLabs path
    if (elConversation.status === 'connected') {
      Promise.resolve(
        elConversation.sendContextualUpdate(
          'The user pasted the following text onto the HUD (it also appears in a TEXT NOTE widget). Treat it as context for what they want to discuss:\n\n' + trimmed,
        ),
      ).catch(() => {});
      return;
    }

    // OpenAI Realtime path
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') return;

    dc.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'The user pasted the following text onto the HUD (it also appears in a TEXT NOTE widget). Treat it as context for what they want to discuss:\n\n' +
                trimmed,
            },
          ],
        },
      })
    );
  }

  // Paste plain text outside inputs → open a TEXT NOTE and inject into realtime session
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;

      const text = e.clipboardData?.getData('text/plain');
      const trimmed = text?.trim();
      if (!trimmed) return;

      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent('jarvis:hud', {
          detail: { command: 'open', widget: 'text', text: trimmed },
        })
      );
      injectPastedHudTextIntoSession(trimmed);
    };

    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, []);

  // Apply theme + grid to <html> whenever settings change
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', settings.theme ?? 'arc-reactor');
    if (settings.grid && settings.grid !== 'off') {
      html.setAttribute('data-grid', settings.grid);
    } else {
      html.removeAttribute('data-grid');
    }
  }, [settings.theme, settings.grid]);

  // Load settings from Core, retaining a read-only legacy fallback for migration.
  useEffect(() => {
    if (serverSettingsQuery.isPending) return;
    const serverSettings = serverSettingsQuery.data ?? {};
        // Pick the best usable source. LocalAI does not require credentials.
        const serverRaw   = serverSettings.jarvis_settings;
        const localRaw    = localStorage.getItem('jarvis_settings');
        const localAIAllowedHere =
          window.electron?.isElectron === true ||
          window.location.hostname === '127.0.0.1' ||
          window.location.hostname === 'localhost';

        const parseConfig = (raw: string | null): Partial<JarvisSettings> | null => {
          try {
            const migrated = migrateLegacyVoiceboxMode(JSON.parse(raw ?? '{}'));
            const parsed = { ...migrated };
            delete parsed.apiKey;
            delete parsed.claudeApiKey;
            const result = jarvisSettingsPatchSchema.safeParse(parsed);
            if (!result.success) {
              console.warn('[Jarvis] Ignored invalid settings source:', result.error.issues);
              return null;
            }
            return result.data;
          } catch {
            return null;
          }
        };
        const serverConfig = parseConfig(serverRaw ?? null);
        const localConfig = parseConfig(localRaw);
        // A 127.0.0.1 LocalAI URL belongs to this Mac, never to every LAN
        // browser that shares server settings.
        // Absent status means "no keys confirmed", which fails closed.
        const credentialStatus = serverSettings.credentialStatus ?? {};
        const serverHasConfig = hasUsableVoiceEngineConfig(serverConfig, false, credentialStatus);
        const localHasConfig = hasUsableVoiceEngineConfig(localConfig, localAIAllowedHere, credentialStatus);
        const localWantsLocal = localConfig?.apiMode === 'local' && localAIAllowedHere;

        const selectedConfig = localWantsLocal
          ? localConfig
          : (serverHasConfig ? serverConfig : null) ??
            (localHasConfig ? localConfig : null) ??
            serverConfig ??
            localConfig;

        if (selectedConfig) {
          try {
            const parsed = { ...selectedConfig };
            // Preserve shared appearance/ability preferences without making a
            // LAN browser connect to LocalAI on its own 127.0.0.1 address.
            if (parsed.apiMode === 'local' && !localAIAllowedHere) {
              parsed.apiMode = 'openai';
              parsed.localAIBaseUrl = DEFAULT_SETTINGS.localAIBaseUrl;
            }
            const enabledFunctions = Array.from(new Set([
              ...DEFAULT_SETTINGS.enabledFunctions,
              ...(parsed.enabledFunctions ?? []),
            ]));
            const nextSettings = jarvisSettingsSchema.parse({
              ...DEFAULT_SETTINGS,
              ...parsed,
              enabledFunctions,
            });
            setSettings(nextSettings);

            // If the legacy reader has a usable configuration but Core doesn't,
            // push it up now. This self-heals after a race-condition wipe.
            if (!serverHasConfig && localHasConfig && nextSettings.apiMode !== 'local') {
              saveSettingsToServer({ jarvis_settings: JSON.stringify(nextSettings) });
            }
          } catch (e) {
            console.error('Failed to parse settings', e);
          }
        }
  }, [serverSettingsQuery.data, serverSettingsQuery.isPending, saveSettingsToServer]);

  // Load dynamic functions (MCP + Skills) on mount — runs before auto-start.
  useEffect(() => {
    const state = dynamicFunctionsQuery.data;
    if (!state || !serverSettingsQuery.isSuccess) return;
    dynamicGetFunctionByNameRef.current = createGetFunctionByName(state.allFunctions);
    allFunctionsRef.current = state.allFunctions;

    // Seed enabledFunctions with new MCP/Skill tool names
    if (state.mcpFunctions.length > 0 || state.skillFunctions.length > 0) {
      setSettings((prev) => {
        const existingEnabled = new Set(prev.enabledFunctions);
        const newTools = [...state.mcpFunctions, ...state.skillFunctions]
          .filter((f) => !existingEnabled.has(f.name))
          .map((f) => f.name);
        if (newTools.length === 0) return prev;
        const updated = {
          ...prev,
          enabledFunctions: [...prev.enabledFunctions, ...newTools],
        };
        saveSettingsToServer({ jarvis_settings: JSON.stringify(updated) });
        return updated;
      });
    }
  }, [dynamicFunctionsQuery.data, saveSettingsToServer, serverSettingsQuery.isSuccess]);

  useEffect(() => {
    enabledFunctionNamesRef.current = new Set(settings.enabledFunctions);
  }, [settings.enabledFunctions]);

  // Keep elClientToolsRef in sync with dynamic function state
  useEffect(() => {
    const fns = (dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY)
      .filter((fn) => settings.enabledFunctions.includes(fn.name));
    elClientToolsRef.current = Object.fromEntries(
      fns.map((fn) => [
        fn.name,
        async (params: Record<string, unknown>) => {
          const result = await fn.handler(params);
          const r = result as Record<string, unknown> | null;
          if (typeof r?.error === 'string') {
            emitError('function', `${fn.name}(): ${r.error}`, 'error');
          }
          return result;
        },
      ]),
    );
  }, [dynamicState.loaded, dynamicState.allFunctions, settings.enabledFunctions]);

  // Continuous rotation for rings
  useEffect(() => {
    const rotate = () => {
      const now = Date.now();
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      setRing1Rotation((prev) => (prev + 40 * delta) % 360);
      setRing2Rotation((prev) => (prev - 20 * delta) % 360);

      rotationFrameRef.current = requestAnimationFrame(rotate);
    };
    rotate();

    return () => {
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
      }
    };
  }, []);

  const isPolledEngineActive =
    elConversation.status === 'connected' || voiceboxConversation.status === 'connected';
  const { audioLevel, fftData } = useVisualizerAudio({
    status,
    remoteStreamRef,
    polledEngineActive: isPolledEngineActive,
    getPolledOutputVolume: () => voiceboxConversation.status === 'connected'
      ? voiceboxConversation.getOutputVolume()
      : elConversation.getOutputVolume(),
  });

  async function startRealtime(currentSettings = settings) {
    try {
      const isLocal = (currentSettings.apiMode ?? 'openai') === 'local';
      const localProfile = getLocalAIProfile(currentSettings.localAIProfile);
      const localAIBaseUrl = normalizeLocalAIBaseUrl(currentSettings.localAIBaseUrl);

      // OpenAI needs a paid API key. LocalAI intentionally does not.
      if (!isLocal && !serverSettingsQuery.data?.credentialStatus?.openaiApiKey) {
        console.warn('No API key found, skipping connection');
        return;
      }

      const realtimeProvider = isLocal
        ? createLocalAIRealtimeAdapter({
            baseUrl: localAIBaseUrl,
            pipelineModel: localProfile.pipelineModel,
            transcriptionModel: localProfile.transcriptionModel,
            profileLabel: localProfile.label,
          })
        : createOpenAIRealtimeAdapter({
            model: currentSettings.realtimeModel ?? 'gpt-realtime-2',
            voice: currentSettings.voice ?? 'echo',
            fetch: desktopControlFetch,
          });
      console.log(
        `%c[Jarvis] startRealtime() called at ${new Date().toLocaleTimeString()} — model: ${isLocal ? localProfile.pipelineModel : (currentSettings.realtimeModel ?? 'gpt-realtime-2')}`,
        'background:#0d2137;color:#4fc3f7;font-weight:bold;padding:2px 6px;border-radius:3px'
      );

      disconnect(); // Ensure clean slate
      // Enter 'starting' before readiness checks: the reducer drops failures
      // raised while idle, which would silently swallow the provider's
      // remediation messages (model not installed, engine unreachable).
      voiceSession.starting();
      await realtimeProvider.prepare();
      
      // Get microphone access
      const { stream } = await acquireMicrophone({
        deviceId: currentSettings.microphoneDeviceId,
        muted: micMutedRef.current,
        onFallback: (error) => {
          console.warn('[Jarvis] Selected microphone is unavailable; falling back to the system default.', error);
        },
      });
      localAudioStreamRef.current = stream;

      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;
      autoReconnectRef.current = false; // will be set true once data channel opens

      // When the WebRTC connection drops, just go idle — do NOT auto-reconnect.
      // Auto-reconnect created a loop: drop → restart → model calls navigate_to_page('home')
      // → page jumps → user has to deactivate Jarvis again, repeat.
      // Jarvis reconnects explicitly when: the app loads, settings are saved, or the
      // user clicks the logo when idle. The user is always in control.
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`%c[Jarvis] WebRTC connectionState → "${state}" at ${new Date().toLocaleTimeString()}`, 'color:#ffa726');
        if (state === 'failed' || state === 'closed') {
          autoReconnectRef.current = false;
          voiceSession.disconnected();
        }
      };

      // Add local audio track
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      
      // Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      // Handle remote audio
      pc.ontrack = (ev) => {
        const [remoteStream] = ev.streams;
        remoteStreamRef.current = remoteStream;
        const audio = remoteAudioRef.current;
        if (audio) {
          audio.srcObject = remoteStream;
          audio.play().catch(e => console.error("Audio play failed", e));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // LocalAI uses a single JSON signaling exchange (no trickle-ICE
      // endpoint), so its offer must contain the gathered ICE candidates.
      if (realtimeProvider.requiresCompleteIce && pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const finish = () => {
            window.clearTimeout(timeout);
            pc.removeEventListener('icegatheringstatechange', onStateChange);
            resolve();
          };
          const timeout = window.setTimeout(finish, 10_000);
          const onStateChange = () => {
            if (pc.iceGatheringState === 'complete') finish();
          };
          pc.addEventListener('icegatheringstatechange', onStateChange);
        });
      }

      const answerSdp = await realtimeProvider.createAnswer(
        pc.localDescription?.sdp ?? offer.sdp ?? '',
      );
      const answer = { type: 'answer', sdp: answerSdp } as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(answer);

      dc.onopen = () => {
        console.log('WebRTC data channel open');
        autoReconnectRef.current = true; // session is live — enable auto-reconnect on drop
        setChatError(null);

        const allFunctions = dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY;
        const enabledTools = allFunctions
          .filter((fn) => currentSettings.enabledFunctions.includes(fn.name))
          .map((fn) => fn.tool);

        console.log(
          `%c[Jarvis] session.update — ${enabledTools.length} tools enabled: ${enabledTools.map(t => t.name).join(', ') || '(none)'}`,
          'background:#1a3a1a;color:#81c784;font-weight:bold;padding:2px 6px;border-radius:3px'
        );

        const sessionConfig = realtimeProvider.createSessionUpdate({
          instructions: buildAssistantInstructions(currentSettings.initialPrompt, currentSettings.speechVocabulary),
          transcriptionPrompt: buildTranscriptionPrompt(currentSettings.speechVocabulary),
          tools: enabledTools,
        });

        dc.send(JSON.stringify(sessionConfig));
        sessionStartTimeRef.current = Date.now();
        voiceSession.connected();

        // Inject any photos already on the HUD into the fresh session
        if (photosRef.current.length > 0) {
          injectPhotosIntoSession(photosRef.current);
        }
      };

      // Accumulate streamed function call arguments
      const pendingCalls: Record<string, { name: string; args: string }> = {};

      dc.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          if (REALTIME_TEXT_DELTA_EVENTS.has(data.type) && typeof data.delta === 'string') {
            const responseKey = realtimeResponseKey(data);
            const currentText = realtimeResponseTextRef.current.get(responseKey) ?? '';
            realtimeResponseTextRef.current.set(responseKey, currentText + data.delta);
          }

          if (REALTIME_TEXT_DONE_EVENTS.has(data.type)) {
            const responseKey = realtimeResponseKey(data);
            const finalText = typeof data.transcript === 'string'
              ? data.transcript
              : (typeof data.text === 'string' ? data.text : undefined);
            completeRealtimeResponse(responseKey, finalText);
          }

          if (data.type === 'error') {
            const errorSource = realtimeProvider.engine === 'local' ? 'local-ai' : 'openai';
            console.error(`${realtimeProvider.label} Realtime Error:`, JSON.stringify(data.error));
            emitError(errorSource, JSON.stringify(data.error));
          }

          if (data.type === 'session.updated') {
            console.log(
              `%c[Jarvis] session.updated — tools: ${(data.session?.tools ?? []).map((t: {name:string}) => t.name).join(', ') || '(none)'}`,
              'background:#1a3a1a;color:#a5d6a7;padding:2px 6px;border-radius:3px'
            );
          }

          if (data.type === 'conversation.item.input_audio_transcription.completed') {
            const transcript = typeof data.transcript === 'string' ? data.transcript.trim() : '';
            const itemId = typeof data.item_id === 'string' ? data.item_id : '';

            let musicIsPlaying = false;
            try {
              const musicData = await queryClient.fetchQuery(nowPlayingQueryOptions());
              musicIsPlaying = musicData?.isPlaying === true;
            } catch {
              // If playback status is unavailable, preserve normal conversation behavior.
            }

            if (musicIsPlaying && !hasJarvisWakeWord(transcript)) {
              console.log('[Jarvis] Ignored background audio while music was playing:', transcript);
              if (itemId) {
                dc.send(JSON.stringify({
                  type: 'conversation.item.delete',
                  item_id: itemId,
                }));
              }
              return;
            }

            if (musicIsPlaying) await duckMusic();
            appendChatMessage('user', transcript);
            voiceSession.thinking();
            // Both providers wait for this gate, so background music cannot
            // trigger speech or tools before the wake-word check completes.
            dc.send(JSON.stringify({ type: 'response.create' }));
            return;
          }

          if (data.type === 'conversation.item.input_audio_transcription.failed') {
            const itemId = typeof data.item_id === 'string' ? data.item_id : '';
            if (itemId) {
              dc.send(JSON.stringify({
                type: 'conversation.item.delete',
                item_id: itemId,
              }));
            }
            return;
          }

          if (
            data.type === 'output_audio_buffer.started' ||
            data.type === 'response.output_audio.delta' ||
            data.type === 'response.audio.delta'
          ) {
            voiceSession.speaking();
          }

          if (
            data.type === 'output_audio_buffer.stopped' ||
            data.type === 'output_audio_buffer.cleared'
          ) {
            voiceSession.listening();
            scheduleMusicRestore();
          }

          if (data.type === 'response.done' && Object.keys(pendingCalls).length === 0) {
            const responseKey = realtimeResponseKey(data);
            const responseOutput = Array.isArray(data.response?.output) ? data.response.output : [];
            const responseText = responseOutput
              .flatMap((item: { content?: unknown }) => Array.isArray(item.content) ? item.content : [])
              .map((part: { transcript?: unknown; text?: unknown }) =>
                typeof part.transcript === 'string'
                  ? part.transcript
                  : (typeof part.text === 'string' ? part.text : '')
              )
              .join('');
            completeRealtimeResponse(responseKey, responseText);
            voiceSession.listening();
            scheduleMusicRestore(500);
          }

          // Accumulate argument deltas
          if (data.type === 'response.function_call_arguments.delta') {
            const id = data.call_id as string;
            if (!pendingCalls[id]) {
              pendingCalls[id] = { name: data.name ?? '', args: '' };
            }
            pendingCalls[id].args += data.delta ?? '';
          }

          // Execute when fully received
          if (data.type === 'response.function_call_arguments.done') {
            const id = data.call_id as string;
            const fnName = data.name as string;
            const rawArgs = data.arguments as string;

            const fn = resolveCallableFunction(fnName);
            if (!fn) {
              // Unknown or disabled. Answer the call so the model is not left
              // waiting on output that will never arrive.
              console.warn(`[Jarvis] Refused tool call for unavailable function: ${fnName}`);
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: id,
                  output: JSON.stringify({ error: `${fnName} is not available.` }),
                },
              }));
              dc.send(JSON.stringify({ type: 'response.create' }));
              delete pendingCalls[id];
              return;
            }

            let parsedArgs: Record<string, unknown> = {};
            try { parsedArgs = JSON.parse(rawArgs || '{}'); } catch { /* empty args */ }

            // Block unsolicited navigation calls in the first 6 seconds after
            // a session connects. This prevents the model from navigating to
            // "home" as part of its automatic reconnect greeting, which was
            // causing the app to jump back to the home page and reset.
            const msSinceSessionStart = Date.now() - sessionStartTimeRef.current;
            if (fnName === 'navigate_to_page' && msSinceSessionStart < 6000) {
              console.warn('[Jarvis] Blocked early navigate_to_page call (auto-reconnect guard). Args:', parsedArgs);
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: id,
                  output: JSON.stringify({ success: true, navigated_to: parsedArgs.page }),
                },
              }));
              dc.send(JSON.stringify({ type: 'response.create' }));
              delete pendingCalls[id];
              return;
            }

            const result = await fn.handler(parsedArgs);
            if (fnName === 'play_spotify') {
              scheduleMusicRestore(MUSIC_PLAYBACK_RESTORE_FALLBACK_MS);
            }

            // Surface function-level errors (e.g. ENOENT, missing API key, network failures)
            // to the Error Terminal widget so they're visible without opening devtools.
            const resultObj = result as Record<string, unknown> & { imageBase64?: string };
            if (typeof resultObj?.error === 'string') {
              emitError('function', `${fnName}(): ${resultObj.error}`, 'error');
            }

            // Extract imageBase64 if present so it's sent as a vision input, not raw text
            const { imageBase64, ...textResult } = resultObj;

            // Send function result back
            dc.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: id,
                output: JSON.stringify(textResult),
              },
            }));

            // If the function returned an image, inject it as a vision message so the model can see it
            if (imageBase64) {
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'user',
                  content: [
                    {
                      type: 'input_image',
                      image_url: `data:image/jpeg;base64,${imageBase64}`,
                    },
                  ],
                },
              }));
            }

            // Ask model to continue responding
            dc.send(JSON.stringify({ type: 'response.create' }));

            if (fnName !== 'control_hud' && fnName !== 'show_hud_text') sfx('notification', 0.6);
            delete pendingCalls[id];
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      };

      dc.onerror = () => {
        console.error("Data channel error");
        voiceSession.fail();
      };

    } catch (error) {
      console.error('Error starting realtime:', error);
      voiceSession.fail(error instanceof Error ? error.message : String(error));
    }
  }

  async function startElevenLabs(currentSettings = settings) {
    try {
      // Only tear down OpenAI WebRTC — do NOT call endSession() here because
      // the ElevenLabs SDK queues it and will fire it on the session we're about to open.
      releaseRealtimeResources();
      voiceSession.starting();

      await probeMicrophonePermission();

      const agentId = currentSettings.elevenLabsAgentId?.trim();
      if (!agentId) {
        console.warn('No ElevenLabs Agent ID configured — add one in Settings.');
        voiceSession.disconnected();
        return;
      }

      const overrideAgent: Record<string, unknown> = {};
      if (currentSettings.initialPrompt) {
        overrideAgent.prompt = { prompt: buildAssistantInstructions(currentSettings.initialPrompt, currentSettings.speechVocabulary) };
      }
      if (currentSettings.elevenLabsFirstMessage?.trim()) overrideAgent.firstMessage = currentSettings.elevenLabsFirstMessage.trim();
      const overrides = Object.keys(overrideAgent).length > 0 ? { agent: overrideAgent } : undefined;

      await elConversation.startSession({
        agentId,
        connectionType: 'websocket',
        ...(overrides && { overrides }),
      });
    } catch (error) {
      console.error('Error starting ElevenLabs session:', error);
      voiceSession.fail(error instanceof Error ? error.message : String(error));
    }
  }

  async function startVoicebox(currentSettings = settings) {
    try {
      // Tear down any OpenAI WebRTC leftovers (mirrors startElevenLabs).
      releaseRealtimeResources();
      voiceSession.starting();

      const provider = currentSettings.brainProvider ?? 'openai';
      await voiceboxConversation.startSession({
        provider,
        model:
          currentSettings.chatModel?.trim() ||
          (provider === 'claude' ? DEFAULT_CLAUDE_CHAT_MODEL : DEFAULT_OPENAI_CHAT_MODEL),
        // Same music routing as the Realtime/ElevenLabs engines; the hook's
        // system prompt already appends the navigate_to_page caveat.
        initialPrompt: buildAssistantInstructions(currentSettings.initialPrompt, currentSettings.speechVocabulary),
        firstMessage: currentSettings.localFirstMessage?.trim() || undefined,
        voiceProfileId: currentSettings.voiceboxProfileId?.trim() || undefined,
        playbackRate: currentSettings.voicePlaybackRate,
        enabledFunctionNames: currentSettings.enabledFunctions,
        getFunctions: () => (dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY),
      });
    } catch (error) {
      // Status/error state is set by the hook's onError callback.
      console.error('Error starting Voicebox session:', error);
    }
  }

  async function start(currentSettings = settings) {
    const mode = currentSettings.apiMode ?? 'openai';
    if (mode === 'elevenlabs') {
      await startElevenLabs(currentSettings);
    } else if (mode === 'voicebox') {
      await startVoicebox(currentSettings);
    } else {
      // Both OpenAI and LocalAI use the realtime/WebRTC transport.
      await startRealtime(currentSettings);
    }
  }

  function disconnect() {
    void restoreMusicVolume();
    realtimeResponseTextRef.current.clear();
    completedRealtimeResponsesRef.current.clear();
    console.log(
      `%c[Jarvis] disconnect() called at ${new Date().toLocaleTimeString()} — stack: ${new Error().stack?.split('\n')[2]?.trim() ?? 'unknown'}`,
      'background:#2d0a0a;color:#ff6b6b;font-weight:bold;padding:2px 6px;border-radius:3px'
    );
    // Mark intentional — prevents auto-reconnect from firing on this close
    autoReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // OpenAI/LocalAI WebRTC cleanup
    releaseRealtimeResources();
    // ElevenLabs cleanup (fire-and-forget; may return undefined if not connected)
    try { elConversation.endSession(); } catch { /* no active session */ }
    // Voicebox cleanup (VAD, playback, history)
    try { voiceboxConversation.endSession(); } catch { /* no active session */ }
    voiceSession.disconnected();
  }

  function setMicrophoneMuted(muted: boolean) {
    micMutedRef.current = muted;
    voiceSession.setMicrophoneMuted(muted);

    setMicrophoneStreamMuted(localAudioStreamRef.current, muted);
    peerConnectionRef.current?.getSenders().forEach((sender) => {
      if (sender.track?.kind === 'audio') sender.track.enabled = !muted;
    });

    try { elConversation.setMuted(muted); } catch { /* ElevenLabs session may be inactive */ }
    try { voiceboxConversation.setMuted(muted); } catch { /* Voicebox session may be inactive */ }
    if (desktopModeRef.current) {
      window.electron?.setDesktopPanelMuted?.(muted);
    }

    if (muted) {
      // User intentionally silenced Jarvis — disable auto-reconnect so that
      // OpenAI's idle-session timeout doesn't trigger a reconnect (and page
      // navigation) while Jarvis is muted.
      autoReconnectRef.current = false;
    } else {
      // User unmuted — if the session died while muted, revive it now.
      // Voicebox has no WebRTC connection; its session stays alive
      // while muted, so a restart is only needed if it actually dropped.
      const sessionAlive =
        (settings.apiMode === 'voicebox' && voiceboxConversation.status === 'connected') ||
        (peerConnectionRef.current !== null &&
          (peerConnectionRef.current.connectionState === 'connected' ||
            peerConnectionRef.current.connectionState === 'connecting'));
      if (!sessionAlive) {
        setRestartTrigger((t) => t + 1);
      } else {
        autoReconnectRef.current = true;
      }
    }
  }

  async function sendTypedChat(): Promise<void> {
    const message = chatText.trim();
    if (!message || chatSending) return;

    setChatSending(true);
    setChatError(null);

    try {
      const mode = settings.apiMode ?? 'openai';
      if (mode === 'elevenlabs') {
        if (elConversation.status !== 'connected') {
          throw new Error('Start Jarvis before sending a message.');
        }
        appendChatMessage('user', message);
        voiceSession.thinking();
        elConversation.sendUserMessage(message);
      } else if (mode === 'voicebox') {
        if (voiceboxConversation.status !== 'connected') {
          throw new Error('Start Jarvis before sending a message.');
        }
        voiceSession.thinking();
        await voiceboxConversation.sendUserMessage(message);
      } else {
        const dataChannel = dataChannelRef.current;
        if (!dataChannel || dataChannel.readyState !== 'open') {
          throw new Error('Start Jarvis before sending a message.');
        }
        appendChatMessage('user', message);
        voiceSession.thinking();
        dataChannel.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: message }],
          },
        }));
        dataChannel.send(JSON.stringify({ type: 'response.create' }));
      }

      setChatText('');
      if (mode !== 'voicebox') void duckMusic();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setChatError(messageText);
    } finally {
      setChatSending(false);
    }
  }

  function handleLogoClick() {
    if (compact) {
      sfx('click', 0.45);
      if (status === 'active' || status === 'listening') {
        console.log(`%c[Jarvis] Logo clicked → DISCONNECTING (status was "${status}")`, 'color:#ef9a9a;font-weight:bold');
        // Fully end the WebRTC stream — no muting, no lingering session.
        // OpenAI cannot call any functions or navigate once disconnected.
        disconnect();
      } else {
        console.log(`%c[Jarvis] Logo clicked → RECONNECTING (status was "${status}")`, 'color:#a5d6a7;font-weight:bold');
        // Jarvis is idle/disconnected — reconnect the stream.
        setRestartTrigger((t) => t + 1);
      }
      return;
    }

    sfx('sfx_settings_open', 0.7);
    setIsSettingsOpen(true);
  }

  // Auto-start on mount / mode change / explicit restart
  // Gates on dynamicState.loaded to prevent race between tool loading and session start.
  useEffect(() => {
    if (!dynamicState.loaded) return;

    const mode = settings.apiMode ?? 'openai';
    const credentialStatus = serverSettingsQuery.data?.credentialStatus;
    const shouldStart =
      mode === 'local' ||
      (mode === 'elevenlabs' && !!settings.elevenLabsAgentId?.trim()) ||
      (mode === 'openai' && !!credentialStatus?.openaiApiKey) ||
      // Voicebox engine needs the API key matching its brain provider
      (mode === 'voicebox' &&
        (settings.brainProvider === 'claude'
          ? !!credentialStatus?.anthropicApiKey
          : !!credentialStatus?.openaiApiKey));

    console.log(
      `%c[Jarvis] Auto-start effect fired at ${new Date().toLocaleTimeString()} — restartTrigger=${restartTrigger}, shouldStart=${shouldStart}, mode=${mode}`,
      'background:#1b2838;color:#66bb6a;font-weight:bold;padding:2px 6px;border-radius:3px'
    );

    const startTimer = shouldStart
      ? window.setTimeout(() => void start(settings), 0)
      : null;

    return () => {
      if (startTimer !== null) window.clearTimeout(startTimer);
      disconnect();
    };
  }, [settings.brainProvider, settings.apiMode, settings.localAIProfile, settings.localAIBaseUrl, settings.microphoneDeviceId, serverSettingsQuery.data?.credentialStatus, restartTrigger, dynamicState.loaded]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleSaveSettings = async (newSettings: JarvisSettingsDraft) => {
    try {
      const credentials: CredentialPatch = {};
      if (newSettings.apiKey?.trim()) credentials.openaiApiKey = newSettings.apiKey.trim();
      if (newSettings.claudeApiKey?.trim()) credentials.anthropicApiKey = newSettings.claudeApiKey.trim();
      if (Object.keys(credentials).length > 0) await saveCredentials(credentials);

      const safeSettings = withoutCredentialValues(newSettings);
      const serialised = JSON.stringify(safeSettings);
      await saveSettingsToServerAsync({ jarvis_settings: serialised });
      setSettings(safeSettings);
      setIsSettingsOpen(false);
      setRestartTrigger((t) => t + 1);
    } catch (error) {
      emitError('app', error instanceof Error ? error.message : String(error));
    }
  };

  // In compact mode, show as greyed-out whenever the stream is not active.
  // Previously this was tied to micMuted, but now compact-click fully disconnects
  // the stream, so status === 'idle' is the correct indicator.
  const isCompactMuted = compact && status !== 'active' && status !== 'listening';
  const visualStatus = isCompactMuted ? 'idle' : status;
  const visualAudioLevel = isCompactMuted ? 0 : audioLevel;
  const visualFftData = isCompactMuted ? new Array(VISUALIZER_FFT_BARS).fill(0) : fftData;
  const ring1Scale = 1 + visualAudioLevel * 0.08;
  const ring2Scale = 1 + visualAudioLevel * 0.05;
  const logoScale = 1;
  const glowIntensity = 0;
  const chatMode = settings.apiMode ?? 'openai';
  const chatOnline = chatMode === 'elevenlabs'
    ? elConversation.status === 'connected'
    : chatMode === 'voicebox'
      ? voiceboxConversation.status === 'connected'
      : dataChannelRef.current?.readyState === 'open' && status === 'active';

  const gridSize = ({ small: '20px 20px', medium: '40px 40px', large: '80px 80px', off: undefined } as Record<string, string | undefined>)[settings.grid ?? 'off'];

  const pos = settings.position ?? 'center';
  const isCenter = pos === 'center';

  // Flex alignment classes for each position
  const positionClass: Record<string, string> = {
    'center':       'items-center justify-center',
    'top-left':     'items-start justify-start',
    'top-right':    'items-start justify-end',
    'bottom-left':  'items-end justify-start',
    'bottom-right': 'items-end justify-end',
  };
  // Padding so the widget doesn't hug the absolute edge
  const positionPadding: Record<string, string> = {
    'center':       '',
    'top-left':     'pt-12 pl-12',
    'top-right':    'pt-12 pr-12',
    'bottom-left':  'pb-12 pl-12',
    'bottom-right': 'pb-12 pr-12',
  };

  return (
    <div
      className="contents"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      {/* Drag-over overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', border: '2px dashed rgba(34,211,238,0.6)' }}>
          <span className="text-cyan-400 text-2xl font-semibold tracking-widest uppercase select-none">
            Drop image to add to context
          </span>
        </div>
      )}

      {/* Grid overlay */}
      {settings.grid && settings.grid !== 'off' && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 1,
            backgroundImage: `
              linear-gradient(rgba(var(--accent-rgb), 0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(var(--accent-rgb), 0.06) 1px, transparent 1px)
            `,
            backgroundSize: gridSize,
          }}
        />
      )}

      <div className={`fixed inset-0 flex overflow-hidden pointer-events-none select-none ${
        compact
          ? 'items-end justify-end pb-6 pr-6 z-[60]'
          : `${positionClass[pos]} ${positionPadding[pos]}`
      }`}>
        {/* Background with slight gradient — hidden in compact mode */}
        {!compact && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/20 pointer-events-none" />
        )}

        <motion.div
          layout
          transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
          className={`relative flex items-center justify-center aspect-square pointer-events-auto ${
            compact
              ? 'w-[160px]'
              : isCenter
              ? 'w-[80vw] max-w-[500px]'
              : 'w-[50vw] max-w-[340px]'
          }`}
        >

          {/* ── Frequency Ring visualizer (default) ── */}
          {settings.visualizer === 'frequency-ring' && (
            <>
              {/* Ring 2 - Outer */}
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  transform: `rotate(${ring2Rotation}deg) scale(${ring2Scale})`,
                  opacity: visualStatus === 'active' ? 1 : 0.3,
                  transition: 'opacity 300ms'
                }}
              >
                <Image
                  src="/assets/ring2.png"
                  alt=""
                  width={700}
                  height={700}
                  className="w-full h-full object-contain"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(var(--accent-rgb), 0.6))' }}
                  priority
                  draggable={false}
                />
              </div>

              {/* FFT Bars */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <svg className="w-2/3 h-2/3" viewBox="0 0 400 400" style={{ overflow: 'visible' }}>
                  {mounted && visualFftData.map((value, index) => {
                    const angle = (index / VISUALIZER_FFT_BARS) * Math.PI * 2;
                    const radius = 180;
                    const centerX = 200;
                    const centerY = 200;
                    const x = centerX + Math.cos(angle) * radius;
                    const y = centerY + Math.sin(angle) * radius;
                    const barWidth = 5;
                    const baseHeight = 6;
                    const barHeight = baseHeight + value * 25;
                    const opacity = visualStatus === 'active' ? 0.4 + value * 0.6 : 0.1;
                    const rotation = (angle * 180) / Math.PI + 90;
                    return (
                      <g key={index} transform={`translate(${x}, ${y}) rotate(${rotation})`}>
                        <rect
                          x={-barWidth / 2}
                          y={-barHeight / 2}
                          width={barWidth}
                          height={barHeight}
                          fill="var(--accent-hex)"
                          opacity={opacity}
                          rx={2.5}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Ring 1 - Middle */}
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  transform: `rotate(${ring1Rotation}deg) scale(${ring1Scale})`,
                  opacity: visualStatus === 'active' ? 1 : 0.5,
                  transition: 'opacity 200ms'
                }}
              >
                <Image
                  src="/assets/ring1.png"
                  alt=""
                  width={600}
                  height={600}
                  className="w-4/5 h-4/5 object-contain"
                  style={{ filter: 'drop-shadow(0 0 25px rgba(var(--accent-rgb), 0.8))' }}
                  priority
                  draggable={false}
                />
              </div>
            </>
          )}

          {/* ── Arc Reactor visualizer ── */}
          {settings.visualizer === 'arc-reactor' && (
            <div className="absolute inset-0 pointer-events-none">
              <ArcReactorVisualizer
                fftData={visualFftData}
                status={visualStatus}
              />
            </div>
          )}

          {/* ── 3D sphere + particle logo ── */}
          {settings.visualizer === 'sphere-nodes' && (
            <div className="absolute inset-0 z-[5] pointer-events-none">
              <SphereNodesVisualizer
                fftData={visualFftData}
                status={visualStatus}
                logoUrl={`/assets/${settings.logo ?? 'logo'}.png`}
              />
            </div>
          )}

          {/* ── Quarter rings visualizer ── */}
          {settings.visualizer === 'quarter-rings' && (
            <div className="absolute inset-0 pointer-events-none">
              <QuarterRingsVisualizer
                fftData={visualFftData}
                status={visualStatus}
              />
            </div>
          )}

          {/* ── Original HUD visualizer ── */}
          {settings.visualizer === 'original' && (
            <div className="absolute inset-0 pointer-events-none">
              <OriginalVisualizer
                fftData={visualFftData}
                status={visualStatus}
              />
            </div>
          )}

          {/* Logo - Center (Clickable for Settings); 3D mode uses particle logo instead */}
          {settings.visualizer !== 'sphere-nodes' && (
            <div
              className={`relative z-10 w-[55%] h-[55%] cursor-pointer group ${isCompactMuted ? 'opacity-35 grayscale' : ''}`}
              role="button"
              aria-label={compact ? (micMuted ? 'Unmute microphone' : 'Mute microphone') : 'Open settings'}
              aria-pressed={compact ? micMuted : undefined}
              onClick={handleLogoClick}
              style={{
                transform: `scale(${logoScale})`,
                filter: isCompactMuted
                  ? 'drop-shadow(0 0 2px rgba(var(--accent-rgb), 0.25))'
                  : `drop-shadow(0 0 ${glowIntensity}px rgba(var(--accent-rgb), 0.9))`
              }}
            >
              <Image
                src={`/assets/${settings.logo ?? 'logo'}.png`}
                alt="Jarvis Logo"
                width={300}
                height={300}
                className="w-full h-full object-contain group-hover:drop-shadow-[0_0_15px_rgba(34,211,238,0.6)] transition-all"
                priority
                draggable={false}
              />
            </div>
          )}
          {settings.visualizer === 'sphere-nodes' && (
            <button
              type="button"
              aria-label={compact ? (micMuted ? 'Unmute microphone' : 'Mute microphone') : 'Open settings'}
              aria-pressed={compact ? micMuted : undefined}
              className={`absolute z-10 w-[55%] h-[55%] max-w-[280px] max-h-[280px] cursor-pointer rounded-full bg-transparent border-0 p-0 pointer-events-auto group ${
                isCompactMuted ? 'opacity-35' : ''
              }`}
              onClick={handleLogoClick}
            />
          )}

          {/* Status Info — hidden in compact corner mode */}
          {!compact && (
            <div className="absolute bottom-[-100px] left-1/2 -translate-x-1/2 text-center space-y-4 w-full">
              <button 
                onClick={() => {
                  sfx('click', 0.6);
                  if (status === 'active' || status === 'listening') {
                    disconnect();
                  } else {
                    start();
                  }
                }}
                className="flex items-center justify-center gap-3 mx-auto hover:scale-105 transition-transform cursor-pointer group"
              >
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    status === 'idle'
                      ? 'bg-gray-500 group-hover:bg-cyan-400'
                      : status === 'listening'
                      ? 'bg-yellow-400 animate-pulse'
                      : status === 'active'
                      ? 'bg-cyan-400 animate-pulse'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-xl font-semibold text-cyan-400 uppercase tracking-wider group-hover:text-cyan-300 transition-colors">
                  {status === 'idle' ? 'OFFLINE' : status}
                </span>
              </button>

              <p className="text-sm text-white/60 max-w-md px-4 mx-auto">
                {status === 'listening' ? (
                  'Establishing connection...'
                ) : status === 'active' ? (
                  'J.A.R.V.I.S. is online. Click status to disconnect.'
                ) : status === 'error' ? (
                  <>
                    Connection error. Check Settings.
                    {lastError && (
                      <span className="block mt-1 text-xs text-red-400/80 font-mono break-all">
                        {lastError}
                      </span>
                    )}
                  </>
                ) : status === 'idle' ? (
                  'Click status to activate'
                ) : settings.apiMode === 'openai' && !serverSettingsQuery.data?.credentialStatus?.openaiApiKey ? (
                  'Click logo to configure API Key'
                ) : null}
              </p>
              
              {status === 'error' && (
                <button 
                  onClick={() => start()}
                  className="px-4 py-2 bg-cyan-900/50 text-cyan-300 rounded hover:bg-cyan-900/80 transition-colors pointer-events-auto"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </motion.div>

        {/* Hidden Audio Element */}
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      </div>

      {!compact && !isSettingsOpen && (
        <ChatPanel
          messages={chatMessages}
          value={chatText}
          online={chatOnline}
          sending={chatSending}
          micMuted={micMuted}
          error={chatError}
          onChange={setChatText}
          onSend={() => void sendTypedChat()}
          onToggleMic={() => setMicrophoneMuted(!micMutedRef.current)}
        />
      )}

      {/* X-Ray Widget */}
      <XrayWidget />

      {/* Camera Widget */}
      <CameraWidget />

      {/* Photo Widgets */}
      <AnimatePresence>
        {photos.map((photo, i) => (
          <PhotoWidget
            key={photo.id}
            photo={photo}
            index={i}
            onDismiss={dismissPhoto}
          />
        ))}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onSave={handleSaveSettings}
            initialSettings={settings}
            credentialStatus={serverSettingsQuery.data?.credentialStatus}
            dynamicFunctions={dynamicState.mcpFunctions.length > 0 || dynamicState.skillFunctions.length > 0
              ? [...dynamicState.mcpFunctions, ...dynamicState.skillFunctions]
              : []}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
