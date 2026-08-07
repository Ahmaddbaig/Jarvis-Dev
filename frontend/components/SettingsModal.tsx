'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FUNCTION_REGISTRY, JarvisFunction } from '@/frontend/lib/functions';
import { sfx } from '@/frontend/lib/sfx';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: JarvisSettings) => void;
  initialSettings: JarvisSettings;
  dynamicFunctions?: JarvisFunction[];
}

export type JarvisTheme = 'arc-reactor' | 'midnight' | 'crimson' | 'matrix';
export type JarvisGrid = 'off' | 'small' | 'medium' | 'large';
export type JarvisVisualizer = 'frequency-ring' | 'arc-reactor' | 'sphere-nodes' | 'quarter-rings' | 'original';
export type JarvisLogo = 'logo' | 'logo2';
export type JarvisPosition = 'center' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export type RealtimeModel = 'gpt-realtime-2' | 'gpt-realtime-1.5' | 'gpt-realtime-mini';

export interface JarvisSettings {
  apiMode: 'openai' | 'elevenlabs' | 'local';
  apiKey: string;
  realtimeModel?: RealtimeModel;
  /** Ollama model tag used when apiMode === 'local'. */
  localModel?: string;
  /** speechSynthesis voice name for local mode. Empty = best available. */
  localVoice?: string;
  /** Speech output for local mode: macOS voice or the Voicebox app. */
  localTts?: 'system' | 'voicebox';
  /** Voicebox voice profile name to speak with. */
  voiceboxVoice?: string;
  elevenLabsAgentId?: string;
  elevenLabsFirstMessage?: string;
  voice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';
  initialPrompt: string;
  enabledFunctions: string[];
  theme: JarvisTheme;
  grid: JarvisGrid;
  visualizer: JarvisVisualizer;
  logo: JarvisLogo;
  position: JarvisPosition;
  /** Full path to shell (cmd.exe, PowerShell, /bin/zsh). Empty = auto-detect. */
  shellPathOverride?: string;
  /** Full path to python.exe for Computer Use. Empty = bundled binary or PATH. */
  pythonPathOverride?: string;
}

const VISUALIZERS: { id: JarvisVisualizer; name: string; desc: string }[] = [
  { id: 'frequency-ring', name: 'Frequency Ring', desc: 'FFT bars radiating from the logo rings' },
  { id: 'arc-reactor',    name: 'Arc Reactor',    desc: 'Polar wave + segmented reactor rings' },
  {
    id: 'sphere-nodes',
    name: 'Sphere Nodes',
    desc: '3D orbiting nodes + FFT glitch; logo built from particles',
  },
  {
    id: 'quarter-rings',
    name: 'Quarter Rings',
    desc: 'Sporadic quarter-arc rings orbiting the logo with oscillating spin',
  },
  {
    id: 'original',
    name: 'Original',
    desc: 'Multi-layer HUD — tick rings, bump-outs, slot rings, yellow pendulum arc, sweep hand',
  },
];

const LOGOS: { id: JarvisLogo; name: string; src: string }[] = [
  { id: 'logo',  name: 'Classic',  src: '/assets/logo.png'  },
  { id: 'logo2', name: 'Variant',  src: '/assets/logo2.png' },
];

const POSITIONS: { id: JarvisPosition; label: string; icon: string }[] = [
  { id: 'top-left',     label: 'Top Left',     icon: '↖' },
  { id: 'top-right',    label: 'Top Right',    icon: '↗' },
  { id: 'center',       label: 'Center',       icon: '⊙' },
  { id: 'bottom-left',  label: 'Bottom Left',  icon: '↙' },
  { id: 'bottom-right', label: 'Bottom Right', icon: '↘' },
];

type Tab = 'jarvis' | 'abilities' | 'computers' | 'ui' | 'system';

interface CompanionView {
  id: string;
  name: string;
  address: string;
  platform: string;
  arch: string;
  pairedAt: string;
  online: boolean;
  paused?: boolean;
  hostname?: string;
  screen?: { width: number; height: number };
  error?: string;
}

/**
 * Curated Ollama models for Apple-silicon Macs with 48 GB unified memory.
 * qwen3.6:27b is the default: strong tool calling + vision, ~17 GB, leaving
 * ~30 GB of headroom for the app and OS while staying fast enough for voice.
 */
export const LOCAL_MODEL_PRESETS: { id: string; label: string; desc: string }[] = [
  { id: 'qwen3.6:27b', label: 'Qwen3.6 27B', desc: 'Best for this Mac · 17 GB' },
  { id: 'qwen3.6:35b', label: 'Qwen3.6 35B', desc: 'Max quality · 24 GB' },
  { id: 'gpt-oss:20b', label: 'GPT-OSS 20B', desc: 'Fastest · 13 GB' },
];

export const DEFAULT_LOCAL_MODEL = LOCAL_MODEL_PRESETS[0].id;

interface OllamaStatus {
  online: boolean;
  models: { name: string }[];
  error?: string;
}

interface VoiceboxStatus {
  online: boolean;
  profiles: { id: string; name: string; presetVoiceId: string | null }[];
  kokoroReady?: boolean;
  error?: string;
}

const THEMES: { id: JarvisTheme; name: string; accent: string; glow: string }[] = [
  { id: 'arc-reactor', name: 'Arc Reactor', accent: '#22d3ee', glow: 'rgba(34,211,238,0.4)' },
  { id: 'midnight',    name: 'Midnight',    accent: '#a855f7', glow: 'rgba(168,85,247,0.4)'  },
  { id: 'crimson',     name: 'Crimson',     accent: '#ef4444', glow: 'rgba(239,68,68,0.4)'   },
  { id: 'matrix',      name: 'Matrix',      accent: '#22c55e', glow: 'rgba(34,197,94,0.4)'   },
];

const GRID_OPTIONS: { id: JarvisGrid; label: string }[] = [
  { id: 'off',    label: 'Off'    },
  { id: 'small',  label: 'Small'  },
  { id: 'medium', label: 'Medium' },
  { id: 'large',  label: 'Large'  },
];

export function SettingsModal({ isOpen, onClose, onSave, initialSettings, dynamicFunctions = [] }: SettingsModalProps) {
  const [settings, setSettings] = useState<JarvisSettings>(initialSettings);
  const [activeTab, setActiveTab] = useState<Tab>('jarvis');
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagOutput, setDiagOutput] = useState<string | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [voiceboxStatus, setVoiceboxStatus] = useState<VoiceboxStatus | null>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [macPermissions, setMacPermissions] = useState<MacPermissionStatus | null>(null);
  const [permissionBusy, setPermissionBusy] = useState<string | null>(null);
  const [isMacElectron, setIsMacElectron] = useState(false);
  const [companions, setCompanions] = useState<CompanionView[]>([]);
  const [companionAddress, setCompanionAddress] = useState('');
  const [companionCode, setCompanionCode] = useState('');
  const [companionFingerprint, setCompanionFingerprint] = useState('');
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionMessage, setCompanionMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsMacElectron(window.electron?.platform === 'darwin');
  }, []);

  // macOS permission state — refreshed on focus so returning from System
  // Settings shows the new grant without reopening the modal.
  useEffect(() => {
    if (!isOpen) return;

    const refreshMacPermissions = () => {
      if (window.electron?.platform === 'darwin') {
        void window.electron.getMacPermissions?.().then(setMacPermissions);
      }
    };

    refreshMacPermissions();
    window.addEventListener('focus', refreshMacPermissions);
    return () => window.removeEventListener('focus', refreshMacPermissions);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSettings(initialSettings);
      setActiveTab('jarvis');
      setDiagOutput(null);
      setDiagError(null);
    }
  }, [isOpen, initialSettings]);

  // Live Ollama status while the Local LLM engine is selected.
  useEffect(() => {
    if (!isOpen || (settings.apiMode ?? 'openai') !== 'local') return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/local-llm');
        const data = (await res.json()) as OllamaStatus;
        if (!cancelled) setOllamaStatus(data);
      } catch {
        if (!cancelled) setOllamaStatus({ online: false, models: [], error: 'Status check failed' });
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isOpen, settings.apiMode]);

  // Live Voicebox app status while the Local LLM engine is selected.
  useEffect(() => {
    if (!isOpen || (settings.apiMode ?? 'openai') !== 'local') return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/voicebox');
        const data = (await res.json()) as VoiceboxStatus;
        if (!cancelled) setVoiceboxStatus(data);
      } catch {
        if (!cancelled) setVoiceboxStatus({ online: false, profiles: [], error: 'Status check failed' });
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isOpen, settings.apiMode]);

  // macOS system voices for local TTS (populated async by Chromium).
  useEffect(() => {
    if (!isOpen) return;
    const load = () => {
      const english = window.speechSynthesis
        .getVoices()
        .filter((v) => /^en[-_]/i.test(v.lang))
        .sort((a, b) => a.name.localeCompare(b.name));
      setSystemVoices(english);
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [isOpen]);

  async function requestPermission(permission: 'accessibility' | 'screen' | 'microphone') {
    setPermissionBusy(permission);
    try {
      const status = await window.electron?.requestMacPermission?.(permission);
      if (status) setMacPermissions(status);
    } finally {
      setPermissionBusy(null);
    }
  }

  async function refreshCompanions() {
    setCompanionBusy(true);
    setCompanionMessage(null);
    try {
      const response = await fetch('/api/companions', { cache: 'no-store' });
      const data = await response.json() as { devices?: CompanionView[]; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setCompanions(data.devices ?? []);
    } catch (error) {
      setCompanionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCompanionBusy(false);
    }
  }

  async function pairComputer() {
    setCompanionBusy(true);
    setCompanionMessage(null);
    try {
      const response = await fetch('/api/companions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pair',
          address: companionAddress.trim(),
          code: companionCode.trim(),
          fingerprint: companionFingerprint.trim(),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setCompanionCode('');
      setCompanionFingerprint('');
      setCompanionMessage('Computer paired securely.');
      const listResponse = await fetch('/api/companions', { cache: 'no-store' });
      const listData = await listResponse.json() as { devices?: CompanionView[] };
      if (listResponse.ok) setCompanions(listData.devices ?? []);
    } catch (error) {
      setCompanionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCompanionBusy(false);
    }
  }

  async function removeComputer(id: string) {
    setCompanionBusy(true);
    setCompanionMessage(null);
    try {
      const response = await fetch('/api/companions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setCompanions((current) => current.filter((device) => device.id !== id));
      setCompanionMessage('Computer removed from Jarvis.');
    } catch (error) {
      setCompanionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCompanionBusy(false);
    }
  }

  function viewComputer(device: CompanionView) {
    sfx('click_sfx', 0.5);
    window.dispatchEvent(new CustomEvent('jarvis:hud', {
      detail: {
        command: 'open',
        widget: 'companion-display',
        title: `${device.name} Display`,
        widget_config: { target: device.id, name: device.name, screen: 0 },
      },
    }));
    onClose();
  }

  async function runDiagnostics() {
    sfx('click_sfx', 0.5);
    setDiagLoading(true);
    setDiagError(null);
    setDiagOutput(null);
    try {
      const res = await fetch('/api/system-diagnostics');
      if (!res.ok) {
        setDiagError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setDiagOutput(JSON.stringify(data, null, 2));
    } catch (e) {
      setDiagError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen && activeTab === 'computers') void refreshCompanions();
  // refreshCompanions is intentionally triggered only when this tab opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'jarvis',    label: 'Jarvis'     },
    { id: 'abilities', label: 'Abilities'  },
    { id: 'computers', label: 'Computers'  },
    { id: 'ui',        label: 'UI'         },
    { id: 'system',    label: 'System'     },
  ];

  const panelMaxWidth = activeTab === 'system' || activeTab === 'computers' ? 'max-w-2xl' : 'max-w-md';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className={`w-full ${panelMaxWidth} bg-black/90 border border-cyan-500/50 rounded-lg shadow-[0_0_30px_rgba(34,211,238,0.2)] overflow-hidden`}
        style={{ boxShadow: `0 0 30px var(--accent-glow)` }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-cyan-500/30 bg-cyan-950/30 flex items-center justify-between">
          <h2 className="text-xl font-bold text-cyan-400 tracking-wider">SYSTEM CONFIGURATION</h2>
          <button onClick={onClose} className="text-cyan-500 hover:text-cyan-300">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-cyan-500/20 bg-cyan-950/10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { sfx('switch_interface', 0.5, 2); setActiveTab(tab.id); }}
              className={`flex-1 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-950/30'
                  : 'text-cyan-600 hover:text-cyan-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={`p-6 space-y-6 overflow-y-auto ${activeTab === 'system' || activeTab === 'computers' ? 'max-h-[65vh]' : 'max-h-[55vh]'}`}>

          {/* Jarvis Tab */}
          {activeTab === 'jarvis' && (
            <>
              {/* API Mode switcher */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Engine</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['openai', 'elevenlabs', 'local'] as const).map((mode) => {
                    const active = (settings.apiMode ?? 'openai') === mode;
                    const labels = { openai: 'OpenAI Realtime', elevenlabs: 'ElevenLabs', local: 'Local LLM' };
                    const descs  = { openai: 'GPT-4o via WebRTC', elevenlabs: 'Jarvis Agent via WebRTC', local: 'On-device via Ollama' };
                    return (
                      <button
                        key={mode}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, apiMode: mode }); }}
                        className={`flex flex-col items-start px-3 py-2.5 border rounded text-left transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        }`}
                      >
                        <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {labels[mode]}
                        </span>
                        <span className="text-[10px] text-white/30 mt-0.5">{descs[mode]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* OpenAI fields */}
              {(settings.apiMode ?? 'openai') === 'openai' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">OpenAI API Key</label>
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                  />
                </div>
              )}

              {(settings.apiMode ?? 'openai') === 'openai' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Realtime Model</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: 'gpt-realtime-2',    label: 'Realtime 2',    desc: 'Reasoning' },
                      { id: 'gpt-realtime-1.5',  label: 'Realtime 1.5',  desc: 'Best voice' },
                      { id: 'gpt-realtime-mini', label: 'Realtime Mini', desc: 'Cost-efficient' },
                    ] as { id: RealtimeModel; label: string; desc: string }[]).map((m) => {
                      const active = (settings.realtimeModel ?? 'gpt-realtime-2') === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => { sfx('select', 0.5); setSettings({ ...settings, realtimeModel: m.id }); }}
                          className={`flex flex-col items-center px-2 py-2 border rounded text-xs transition-all ${
                            active
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                              : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                          }`}
                        >
                          <span className="font-bold uppercase tracking-wide">{m.label}</span>
                          <span className="text-[10px] opacity-70 mt-0.5">{m.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ElevenLabs fields */}
              {(settings.apiMode ?? 'openai') === 'elevenlabs' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Agent ID</label>
                    <input
                      type="text"
                      value={settings.elevenLabsAgentId ?? ''}
                      onChange={(e) => setSettings({ ...settings, elevenLabsAgentId: e.target.value })}
                      placeholder="agent_..."
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-cyan-700">Found in your ElevenLabs agent dashboard.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">First Message <span className="text-cyan-700 normal-case font-normal">(optional override)</span></label>
                    <input
                      type="text"
                      value={settings.elevenLabsFirstMessage ?? ''}
                      onChange={(e) => setSettings({ ...settings, elevenLabsFirstMessage: e.target.value })}
                      placeholder="Good evening, sir. All systems online."
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-cyan-700">Leave empty to use the agent&apos;s default greeting.</p>
                  </div>
                </div>
              )}

              {/* Local LLM fields */}
              {(settings.apiMode ?? 'openai') === 'local' && (
                <div className="space-y-4">
                  {/* Ollama status */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        ollamaStatus === null
                          ? 'bg-cyan-800'
                          : ollamaStatus.online
                            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                            : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                      }`}
                    />
                    <span className="text-xs text-cyan-500 uppercase tracking-widest font-bold">
                      {ollamaStatus === null ? 'Checking Ollama…' : ollamaStatus.online ? 'Ollama online' : 'Ollama offline'}
                    </span>
                  </div>
                  {ollamaStatus !== null && !ollamaStatus.online && (
                    <p className="text-xs text-red-400/90 leading-relaxed">
                      {ollamaStatus.error ?? 'Ollama is not reachable on 127.0.0.1:11434.'}
                    </p>
                  )}

                  {/* Model picker */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Local Model</label>
                    <div className="grid grid-cols-1 gap-2">
                      {LOCAL_MODEL_PRESETS.map((m) => {
                        const active = (settings.localModel ?? DEFAULT_LOCAL_MODEL) === m.id;
                        const installed = ollamaStatus?.models.some(
                          (im) => im.name === m.id || im.name === `${m.id}:latest`,
                        ) ?? false;
                        return (
                          <button
                            key={m.id}
                            onClick={() => { sfx('select', 0.5); setSettings({ ...settings, localModel: m.id }); }}
                            className={`flex items-center justify-between px-3 py-2.5 border rounded text-left transition-all ${
                              active
                                ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                                : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                            }`}
                          >
                            <span className="flex flex-col">
                              <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                                {m.label}
                              </span>
                              <span className="text-[10px] text-white/30 mt-0.5">{m.desc}</span>
                            </span>
                            {ollamaStatus?.online && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-mono ${
                                installed
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              }`}>
                                {installed ? 'Installed' : 'Not pulled'}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      value={settings.localModel ?? DEFAULT_LOCAL_MODEL}
                      onChange={(e) => setSettings({ ...settings, localModel: e.target.value })}
                      placeholder="Custom Ollama model tag, e.g. qwen3.6:27b"
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-cyan-700">
                      Missing a model? Pull it with <span className="text-cyan-500 font-mono">ollama pull {settings.localModel ?? DEFAULT_LOCAL_MODEL}</span>
                    </p>
                  </div>

                  {/* Speech output engine */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Speech Output</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { id: 'voicebox', label: 'Voicebox App', desc: 'AI voices & clones, on-device' },
                        { id: 'system',   label: 'System Voice', desc: 'macOS speech synthesis' },
                      ] as { id: 'voicebox' | 'system'; label: string; desc: string }[]).map((opt) => {
                        const active = (settings.localTts ?? 'voicebox') === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => { sfx('select', 0.5); setSettings({ ...settings, localTts: opt.id }); }}
                            className={`flex flex-col items-start px-3 py-2.5 border rounded text-left transition-all ${
                              active
                                ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                                : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                            }`}
                          >
                            <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                              {opt.label}
                            </span>
                            <span className="text-[10px] text-white/30 mt-0.5">{opt.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Voicebox voice picker */}
                  {(settings.localTts ?? 'voicebox') === 'voicebox' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            voiceboxStatus === null
                              ? 'bg-cyan-800'
                              : voiceboxStatus.online
                                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                                : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                          }`}
                        />
                        <span className="text-xs text-cyan-500 uppercase tracking-widest font-bold">
                          {voiceboxStatus === null ? 'Checking Voicebox…' : voiceboxStatus.online ? 'Voicebox online' : 'Voicebox offline'}
                        </span>
                      </div>
                      {voiceboxStatus !== null && !voiceboxStatus.online && (
                        <p className="text-xs text-red-400/90">Open the Voicebox app — Jarvis will fall back to the system voice until it&apos;s running.</p>
                      )}
                      <select
                        value={settings.voiceboxVoice ?? 'Jarvis'}
                        onChange={(e) => { sfx('select', 0.5); setSettings({ ...settings, voiceboxVoice: e.target.value }); }}
                        className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 transition-all text-sm"
                      >
                        {(voiceboxStatus?.profiles ?? []).map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}{p.presetVoiceId ? ` (${p.presetVoiceId})` : ' (custom)'}
                          </option>
                        ))}
                        {!(voiceboxStatus?.profiles ?? []).some((p) => p.name === (settings.voiceboxVoice ?? 'Jarvis')) && (
                          <option value={settings.voiceboxVoice ?? 'Jarvis'}>{settings.voiceboxVoice ?? 'Jarvis'}</option>
                        )}
                      </select>
                      <p className="text-xs text-cyan-700">
                        Voice profiles come from the Voicebox app — clone or design a voice there and pick it here.
                      </p>
                    </div>
                  )}

                  {/* System voice picker */}
                  {(settings.localTts ?? 'voicebox') === 'system' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">System Voice</label>
                      <select
                        value={settings.localVoice ?? ''}
                        onChange={(e) => { sfx('select', 0.5); setSettings({ ...settings, localVoice: e.target.value }); }}
                        className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 transition-all text-sm"
                      >
                        <option value="">Auto — best available (prefers British English)</option>
                        {systemVoices.map((v) => (
                          <option key={v.name} value={v.name}>{`${v.name} (${v.lang})`}</option>
                        ))}
                      </select>
                      <p className="text-xs text-cyan-700">
                        Uses macOS speech synthesis — add higher-quality Siri voices in System Settings → Accessibility → Spoken Content.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Voice Interface — OpenAI only */}
              {(settings.apiMode ?? 'openai') === 'openai' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Interface</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const).map((voice) => (
                      <button
                        key={voice}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, voice }); }}
                        className={`px-3 py-2 border rounded text-sm uppercase tracking-wide transition-all ${
                          settings.voice === voice
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                        }`}
                      >
                        {voice}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Visualizer</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {VISUALIZERS.map((v) => {
                    const active = settings.visualizer === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, visualizer: v.id }); }}
                        className={`flex flex-col items-start px-3 py-2.5 border rounded text-left transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        }`}
                      >
                        <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {v.name}
                        </span>
                        <span className="text-[10px] text-white/30 mt-0.5 leading-tight">{v.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Center Logo</label>
                <div className="grid grid-cols-2 gap-2">
                  {LOGOS.map((l) => {
                    const active = (settings.logo ?? 'logo') === l.id;
                    return (
                      <button
                        key={l.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, logo: l.id }); }}
                        className={`flex flex-col items-center gap-2 px-3 py-3 border rounded transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={l.src} alt={l.name} className="w-24 h-24 object-contain opacity-90" />
                        <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {l.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Position</label>
                <div className="grid grid-cols-3 gap-2">
                  {POSITIONS.map((p) => {
                    const active = (settings.position ?? 'center') === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, position: p.id }); }}
                        className={`flex flex-col items-center gap-1 px-2 py-2.5 border rounded transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        } ${p.id === 'center' ? 'col-start-2' : ''}`}
                      >
                        <span className={`text-base leading-none ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>{p.icon}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wide leading-tight text-center ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {p.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Initial Protocol (Prompt)</label>
                <textarea
                  value={settings.initialPrompt}
                  onChange={(e) => setSettings({ ...settings, initialPrompt: e.target.value })}
                  rows={4}
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm resize-none"
                />
              </div>
            </>
          )}

          {/* Abilities Tab */}
          {activeTab === 'abilities' && (
            <div className="space-y-3">
              <p className="text-xs text-cyan-600">
                Enable modules to give Jarvis access to real-time data and actions.
              </p>
              <div className="space-y-2">
                {FUNCTION_REGISTRY.map((fn) => {
                  const enabled = settings.enabledFunctions.includes(fn.name);
                  return (
                    <div
                      key={fn.name}
                      className="flex items-center justify-between px-4 py-3 rounded border border-cyan-500/20 bg-cyan-950/10"
                    >
                      <div>
                        <p className="text-sm text-cyan-300 font-semibold">{fn.label}</p>
                        <p className="text-xs text-cyan-600 mt-0.5">{fn.description}</p>
                      </div>
                      <button
                        onClick={() => {
                          sfx('click_sfx', 0.5);
                          setSettings({
                            ...settings,
                            enabledFunctions: enabled
                              ? settings.enabledFunctions.filter((n) => n !== fn.name)
                              : [...settings.enabledFunctions, fn.name],
                          });
                        }}
                        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ml-4 ${
                          enabled ? 'bg-cyan-500' : 'bg-cyan-900/60'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>

              {dynamicFunctions.length > 0 && (
                <>
                  <div className="mt-4 mb-2 border-t border-cyan-500/20 pt-4">
                    <p className="text-xs font-bold text-cyan-500 uppercase tracking-widest">MCP &amp; Skills</p>
                    <p className="text-[10px] text-cyan-700 mt-1">External tools loaded from configuration.</p>
                  </div>
                  {dynamicFunctions.map((fn) => {
                    const enabled = settings.enabledFunctions.includes(fn.name);
                    const isMcp = fn.description.includes('MCP');
                    return (
                      <div key={fn.name} className="flex items-center justify-between px-4 py-3 rounded border border-cyan-500/20 bg-cyan-950/10">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-cyan-300 font-semibold">{fn.label}</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/30 uppercase font-mono">
                              {isMcp ? 'MCP' : 'Skill'}
                            </span>
                          </div>
                          <p className="text-xs text-cyan-600 mt-0.5 truncate">{fn.description}</p>
                        </div>
                        <button
                          onClick={() => {
                            sfx('click_sfx', 0.5);
                            setSettings({
                              ...settings,
                              enabledFunctions: enabled
                                ? settings.enabledFunctions.filter((n) => n !== fn.name)
                                : [...settings.enabledFunctions, fn.name],
                            });
                          }}
                          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ml-4 ${
                            enabled ? 'bg-cyan-500' : 'bg-cyan-900/60'
                          }`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Computers — Jarvis Companion pairing and status */}
          {activeTab === 'computers' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Pair a Computer</h3>
                <p className="text-[11px] text-cyan-700 mt-1 leading-relaxed">
                  Start Jarvis Companion on the Mac or Windows PC you want to control, then copy the address,
                  six-digit code, and certificate fingerprint shown there. Both computers must be on the same private network.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Companion Address</span>
                  <input
                    type="text"
                    value={companionAddress}
                    onChange={(event) => setCompanionAddress(event.target.value)}
                    placeholder="https://192.168.1.20:45831"
                    className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Pairing Code</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={companionCode}
                    onChange={(event) => setCompanionCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm tracking-[0.3em]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">TLS Fingerprint</span>
                  <input
                    type="text"
                    value={companionFingerprint}
                    onChange={(event) => setCompanionFingerprint(event.target.value)}
                    placeholder="a1b2-c3d4-e5f6-7890"
                    className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void pairComputer()}
                disabled={companionBusy || !companionAddress.trim() || companionCode.length !== 6 || !companionFingerprint.trim()}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
              >
                {companionBusy ? 'Connecting…' : 'Pair Computer'}
              </button>

              {companionMessage && (
                <p className="text-xs text-cyan-300 border border-cyan-500/20 bg-cyan-950/20 rounded px-3 py-2">
                  {companionMessage}
                </p>
              )}

              <div className="border-t border-cyan-500/20 pt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Paired Computers</h3>
                    <p className="text-[10px] text-cyan-700 mt-1">The companion must stay running while Jarvis controls that computer.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshCompanions()}
                    disabled={companionBusy}
                    className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-40"
                  >
                    Refresh
                  </button>
                </div>

                {companions.length === 0 ? (
                  <p className="text-xs text-cyan-700 border border-dashed border-cyan-500/20 rounded px-4 py-5 text-center">
                    No companion computers paired yet.
                  </p>
                ) : companions.map((device) => (
                  <div key={device.id} className="border border-cyan-500/20 bg-cyan-950/10 rounded p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${device.online && !device.paused ? 'bg-emerald-400' : device.online ? 'bg-amber-400' : 'bg-red-400'}`} />
                          <p className="text-sm font-semibold text-cyan-200 truncate">{device.name}</p>
                          <span className="text-[9px] uppercase border border-cyan-500/20 rounded px-1.5 py-0.5 text-cyan-600">
                            {device.platform}
                          </span>
                        </div>
                        <p className="text-[10px] text-cyan-700 font-mono mt-1 break-all">{device.address}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeComputer(device.id)}
                        disabled={companionBusy}
                        className="text-[10px] uppercase tracking-wider text-red-400/70 hover:text-red-300 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="text-[10px] text-cyan-600">
                      {!device.online
                        ? `Offline${device.error ? ` — ${device.error}` : ''}`
                        : device.paused
                          ? 'Online — control paused from the companion tray'
                          : `Ready${device.screen ? ` — ${device.screen.width}×${device.screen.height}` : ''}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => viewComputer(device)}
                      disabled={!device.online || device.paused}
                      className="rounded border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      View Display
                    </button>
                  </div>
                ))}
              </div>

              <p className="text-[10px] leading-relaxed text-cyan-700 border border-cyan-500/20 bg-cyan-950/20 rounded px-3 py-2">
                In Abilities, enable <span className="text-cyan-400">Companion Computers</span> for launch, typing,
                keypress, and click commands. Enable <span className="text-cyan-400">Computer Use</span> for visual control.
              </p>
            </div>
          )}

          {/* System — terminal & computer use diagnostics / overrides */}
          {activeTab === 'system' && (
            <div className="space-y-5">
              <p className="text-xs text-cyan-600 leading-relaxed">
                Jarvis usually detects your shell and Python automatically. Use overrides only if Terminal or Computer Use
                fail after a restart. Run diagnostics and share the JSON if you need support.
              </p>

              {isMacElectron && (
                <div className="space-y-3 border border-cyan-500/25 bg-cyan-950/15 rounded p-4">
                  <div>
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">macOS Permissions</h3>
                    <p className="text-[10px] text-cyan-700 mt-1 leading-relaxed">
                      Accessibility lets Jarvis control the mouse and keyboard. Screen Recording lets Computer Use see the screen. You must approve each switch in macOS.
                    </p>
                  </div>

                  {([
                    ['accessibility', 'Accessibility', macPermissions?.accessibility],
                    ['screen', 'Screen Recording', macPermissions?.screen],
                    ['microphone', 'Microphone', macPermissions?.microphone],
                  ] as const).map(([id, label, status]) => {
                    const granted = status === 'granted';
                    return (
                      <div key={id} className="flex items-center justify-between gap-3 border-t border-cyan-500/10 pt-3">
                        <div>
                          <div className="text-xs text-cyan-200">{label}</div>
                          <div className={`text-[10px] uppercase tracking-wider ${granted ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {granted ? 'Granted' : (status || 'Not checked')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void requestPermission(id)}
                          disabled={permissionBusy !== null}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          {permissionBusy === id ? 'Opening…' : granted ? 'Review' : 'Grant'}
                        </button>
                      </div>
                    );
                  })}

                  {macPermissions?.appBundlePath && (
                    <div className="border-t border-cyan-500/10 pt-3 space-y-2">
                      <p className="text-[10px] text-cyan-700 font-mono break-all">
                        Add this app if macOS does not list it: {macPermissions.appBundlePath}
                      </p>
                      <button
                        type="button"
                        onClick={() => void window.electron?.revealMacPermissionApp?.()}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                      >
                        Reveal App in Finder
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                  Shell path override
                </label>
                <input
                  type="text"
                  value={settings.shellPathOverride ?? ''}
                  onChange={(e) => setSettings({ ...settings, shellPathOverride: e.target.value })}
                  placeholder="Auto — e.g. C:\Windows\System32\cmd.exe or /bin/zsh"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-xs"
                />
                <p className="text-[10px] text-cyan-700">
                  Windows: <span className="text-cyan-500">cmd.exe</span> or <span className="text-cyan-500">powershell.exe</span>.
                  macOS: e.g. <span className="text-cyan-500">/bin/zsh</span>. Leave empty for default.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                  Python for Computer Use
                </label>
                <input
                  type="text"
                  value={settings.pythonPathOverride ?? ''}
                  onChange={(e) => setSettings({ ...settings, pythonPathOverride: e.target.value })}
                  placeholder="Auto — e.g. C:\Users\you\AppData\Local\Programs\Python\Python312\python.exe"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-xs"
                />
                <p className="text-[10px] text-cyan-700">
                  Forces <span className="text-cyan-500">computer_use.py</span> to run with this interpreter. Overrides the bundled
                  helper binary if set (useful for debugging). Leave empty when the bundled <span className="text-cyan-500">.exe</span> works.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void runDiagnostics()}
                  disabled={diagLoading}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {diagLoading ? 'Running…' : 'Run system diagnostics'}
                </button>
                {diagError && (
                  <p className="text-xs text-red-400 font-mono">{diagError}</p>
                )}
                {diagOutput && (
                  <pre className="text-[10px] leading-snug text-cyan-200/90 bg-black/50 border border-cyan-500/20 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre">
                    {diagOutput}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* UI Tab */}
          {activeTab === 'ui' && (
            <div className="space-y-7">

              {/* Theme */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Theme</label>
                <div className="grid grid-cols-2 gap-3">
                  {THEMES.map((theme) => {
                    const active = settings.theme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, theme: theme.id }); }}
                        className={`relative flex items-center gap-3 px-4 py-3 rounded border transition-all text-left ${
                          active
                            ? 'border-white/30 bg-white/5'
                            : 'border-white/10 bg-transparent hover:border-white/20'
                        }`}
                        style={active ? { boxShadow: `0 0 12px ${theme.glow}` } : {}}
                      >
                        {/* Color swatch */}
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: theme.accent,
                            boxShadow: `0 0 8px ${theme.glow}`,
                          }}
                        />
                        <span className={`text-sm font-semibold tracking-wide ${active ? 'text-white' : 'text-white/50'}`}>
                          {theme.name}
                        </span>
                        {active && (
                          <span className="absolute top-1.5 right-2 text-[10px] text-white/40 font-mono uppercase">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Grid */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Background Grid</label>
                <div className="grid grid-cols-4 gap-2">
                  {GRID_OPTIONS.map((opt) => {
                    const active = settings.grid === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => { sfx('click_sfx', 0.4); setSettings({ ...settings, grid: opt.id }); }}
                        className={`px-3 py-2 border rounded text-xs uppercase tracking-wide transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                            : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-cyan-500/30 bg-cyan-950/30 flex justify-end gap-3">
          <button
            onClick={() => { sfx('click', 0.5); onClose(); }}
            className="px-4 py-2 text-sm text-cyan-500 hover:text-cyan-300 transition-colors uppercase tracking-wider"
          >
            Cancel
          </button>
          <button
            onClick={() => { sfx('select_confirm', 0.6); onSave(settings); }}
            className="px-6 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded text-cyan-300 uppercase tracking-wider font-bold shadow-[0_0_15px_rgba(34,211,238,0.1)] hover:shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all"
          >
            Save Configuration
          </button>
        </div>
      </motion.div>
    </div>
  );
}
