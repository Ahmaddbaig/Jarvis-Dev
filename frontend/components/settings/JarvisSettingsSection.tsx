'use client';

import { useEffect, useState } from 'react';
import type {
  CredentialKey,
  CredentialStatus,
  JarvisLogo,
  JarvisPosition,
  JarvisVisualizer,
  RealtimeModel,
} from '@jarvis/contracts';
import type { JarvisSettingsDraft } from '../SettingsModal';
import { sfx } from '@/frontend/lib/sfx';
import {
  DEFAULT_LOCAL_AI_BASE_URL,
  LOCAL_AI_PROFILES,
} from '@/frontend/lib/localAIProfiles';
import { useBrainStatus, useVoiceProfiles } from '@/frontend/hooks/queries/useVoiceModelStatus';

const VISUALIZERS: { id: JarvisVisualizer; name: string; desc: string }[] = [
  { id: 'frequency-ring', name: 'Frequency Ring', desc: 'FFT bars radiating from the logo rings' },
  { id: 'arc-reactor', name: 'Arc Reactor', desc: 'Polar wave + segmented reactor rings' },
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
  { id: 'logo', name: 'Classic', src: '/assets/logo.png' },
  { id: 'logo2', name: 'Variant', src: '/assets/logo2.png' },
];

const POSITIONS: { id: JarvisPosition; label: string; icon: string }[] = [
  { id: 'top-left', label: 'Top Left', icon: '↖' },
  { id: 'top-right', label: 'Top Right', icon: '↗' },
  { id: 'center', label: 'Center', icon: '⊙' },
  { id: 'bottom-left', label: 'Bottom Left', icon: '↙' },
  { id: 'bottom-right', label: 'Bottom Right', icon: '↘' },
];

interface JarvisSettingsSectionProps {
  settings: JarvisSettingsDraft;
  credentialStatus?: CredentialStatus;
  onChange: (settings: JarvisSettingsDraft) => void;
  onDeleteCredential: (key: CredentialKey) => Promise<void>;
}

export function JarvisSettingsSection({ settings, credentialStatus, onChange, onDeleteCredential }: JarvisSettingsSectionProps) {
  const setSettings = onChange;
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);

  const isVoiceboxMode = settings.apiMode === 'voicebox';
  const brainProvider = settings.brainProvider ?? 'openai';
  const brainStatusQuery = useBrainStatus(brainProvider, isVoiceboxMode);
  const voiceProfilesQuery = useVoiceProfiles(isVoiceboxMode);
  const brainStatus = brainStatusQuery.data
    ?? (brainStatusQuery.isError ? { ok: false, error: 'Status check failed' } : null);
  const voiceboxStatus = voiceProfilesQuery.data
    ?? (voiceProfilesQuery.isError ? { ok: false, profiles: [], error: 'Status check failed' } : null);

  useEffect(() => {
    const refreshAudioInputs = async () => {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices();
        setAudioInputs((devices ?? []).filter((device) => device.kind === 'audioinput'));
      } catch {
        setAudioInputs([]);
      }
    };

    void refreshAudioInputs();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioInputs);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshAudioInputs);
  }, []);

  return (
    <>
      {/* API Mode switcher */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Engine</label>
        <div className="grid grid-cols-2 gap-2">
          {(['openai', 'local', 'voicebox', 'elevenlabs'] as const).map((mode) => {
            const active = (settings.apiMode ?? 'openai') === mode;
            const labels = { openai: 'OpenAI', local: 'Local AI', voicebox: 'Voicebox', elevenlabs: 'ElevenLabs' };
            const descs  = {
              openai: 'Paid Realtime API',
              local: 'Free on this Mac',
              voicebox: 'Claude or OpenAI + same cloned voice',
              elevenlabs: 'Hosted voice agent',
            };
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

      {/* OpenAI fields — the key also powers the Voicebox engine's OpenAI brain */}
      {((settings.apiMode ?? 'openai') === 'openai' ||
        (settings.apiMode === 'voicebox' && brainProvider === 'openai')) && (
        <div className="space-y-2">
          <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">OpenAI API Key</label>
          <input
            type="password"
            value={settings.apiKey ?? ''}
            onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            placeholder={credentialStatus?.openaiApiKey ? 'Configured — enter to replace' : 'sk-...'}
            className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
          />
          {credentialStatus?.openaiApiKey && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-green-400">Stored securely in the operating-system vault.</span>
              <button
                type="button"
                onClick={() => void onDeleteCredential('openaiApiKey')}
                className="text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {/* Local AI fields */}
      {(settings.apiMode ?? 'openai') === 'local' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Mac Performance Profile</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.values(LOCAL_AI_PROFILES)).map((profile) => {
                const active = (settings.localAIProfile ?? 'm5') === profile.id;
                return (
                  <button
                    key={profile.id}
                    onClick={() => { sfx('select', 0.5); setSettings({ ...settings, localAIProfile: profile.id }); }}
                    className={`flex flex-col items-center px-2 py-2.5 border rounded text-center transition-all ${
                      active
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                        : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                    }`}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide">{profile.label}</span>
                    <span className="text-[10px] opacity-70 mt-0.5">{profile.hardware}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-relaxed text-cyan-700">
              {LOCAL_AI_PROFILES[settings.localAIProfile ?? 'm5'].description}
              {' '}Models are never downloaded when you switch here. Run the matching installer once on each Mac.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Local AI Server</label>
            <input
              type="url"
              value={settings.localAIBaseUrl ?? DEFAULT_LOCAL_AI_BASE_URL}
              onChange={(e) => setSettings({ ...settings, localAIBaseUrl: e.target.value })}
              placeholder={DEFAULT_LOCAL_AI_BASE_URL}
              className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
            />
            <p className="text-[10px] text-cyan-700">
              No API key or subscription. Leave this on 127.0.0.1 when the model runs on the same Mac.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Microphone Input</label>
            <select
              value={settings.microphoneDeviceId ?? ''}
              onChange={(e) => setSettings({ ...settings, microphoneDeviceId: e.target.value })}
              className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
            >
              <option value="">System default microphone</option>
              {audioInputs.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
            <p className="text-[10px] leading-relaxed text-cyan-700">
              For clearer recognition while wearing Bluetooth headphones, try selecting the MacBook microphone instead of the headset microphone.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Speech Vocabulary</label>
            <textarea
              value={settings.speechVocabulary ?? ''}
              onChange={(e) => setSettings({ ...settings, speechVocabulary: e.target.value })}
              placeholder="Skillet, Ahmad, Bambu Lab, project names, device names…"
              rows={3}
              maxLength={1000}
              className="w-full resize-y bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
            />
            <p className="text-[10px] leading-relaxed text-cyan-700">
              Add names, artists, applications, devices, acronyms, and technical terms separated by commas or new lines. Local AI uses them as recognition hints for every ability.
            </p>
          </div>

          <p className="text-[10px] leading-relaxed text-cyan-600 border border-cyan-500/20 bg-cyan-950/20 rounded px-3 py-2">
            Local voice: Kokoro British male — a more natural, calm synthetic voice. It is Jarvis-inspired, not a clone of an actor&apos;s voice.
          </p>
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

      {/* Voicebox engine fields */}
      {(settings.apiMode ?? 'openai') === 'voicebox' && (
        <div className="space-y-4">
          {/* Service status */}
          <div className="space-y-1 text-xs font-mono">
            <p className={brainStatus?.ok ? 'text-green-400' : 'text-red-400'}>
              ● Brain ({brainProvider === 'claude' ? 'Claude API' : 'OpenAI API'}) {brainStatus === null ? '— checking…' : brainStatus.ok ? 'ready' : `not ready — ${brainStatus.error ?? 'no API key'}`}
            </p>
            <p className={voiceboxStatus?.ok ? 'text-green-400' : 'text-red-400'}>
              ● Voicebox {voiceboxStatus === null ? '— checking…' : voiceboxStatus.ok ? 'online' : `offline — ${voiceboxStatus.error ?? 'not reachable'}`}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Brain Provider</label>
            <select
              value={brainProvider}
              onChange={(e) => {
                sfx('select', 0.5);
                const provider = e.target.value === 'claude' ? 'claude' as const : 'openai' as const;
                setSettings({
                  ...settings,
                  brainProvider: provider,
                  // Reset to the provider's default model so a GPT model
                  // is never sent to the Claude API or vice versa.
                  chatModel: provider === 'claude' ? 'claude-haiku-4-5' : 'gpt-4o-mini',
                });
              }}
              className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
            >
              <option value="openai" className="bg-slate-900">OpenAI (GPT)</option>
              <option value="claude" className="bg-slate-900">Claude (Anthropic)</option>
            </select>
          </div>

          {brainProvider === 'claude' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Claude API Key</label>
              <input
                type="password"
                value={settings.claudeApiKey ?? ''}
                onChange={(e) => setSettings({ ...settings, claudeApiKey: e.target.value })}
                placeholder={credentialStatus?.anthropicApiKey ? 'Configured — enter to replace' : 'sk-ant-...'}
                className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
              />
              {credentialStatus?.anthropicApiKey && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] text-green-400">Stored securely in the operating-system vault.</span>
                  <button
                    type="button"
                    onClick={() => void onDeleteCredential('anthropicApiKey')}
                    className="text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
              Brain Model ({brainProvider === 'claude' ? 'Claude' : 'OpenAI'})
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(brainProvider === 'claude'
                ? ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']
                : ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']
              ).map((model) => {
                const fallback = brainProvider === 'claude' ? 'claude-haiku-4-5' : 'gpt-4o-mini';
                const active = (settings.chatModel ?? fallback) === model;
                return (
                  <button
                    key={model}
                    onClick={() => { sfx('select', 0.5); setSettings({ ...settings, chatModel: model }); }}
                    className={`px-3 py-2 border rounded text-xs font-mono text-left transition-all ${
                      active
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                        : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                    }`}
                  >
                    {model}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={settings.chatModel ?? (brainProvider === 'claude' ? 'claude-haiku-4-5' : 'gpt-4o-mini')}
              onChange={(e) => setSettings({ ...settings, chatModel: e.target.value })}
              placeholder={brainProvider === 'claude' ? 'claude-haiku-4-5' : 'gpt-4o-mini'}
              className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
            />
            <p className="text-xs text-cyan-700">
              {brainProvider === 'claude'
                ? 'Uses the Claude API key above. Any Claude model with tool calling works.'
                : 'Uses the OpenAI API key above. Any chat model with tool calling works.'}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice (Voicebox profile)</label>
            {voiceboxStatus?.ok && voiceboxStatus.profiles.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {voiceboxStatus.profiles.map((profile) => {
                  const active = (settings.voiceboxProfileId ?? '') === profile.id
                    || (!settings.voiceboxProfileId && profile.name === 'Jarvis');
                  return (
                    <button
                      key={profile.id}
                      onClick={() => { sfx('select', 0.5); setSettings({ ...settings, voiceboxProfileId: profile.id }); }}
                      className={`px-3 py-2 border rounded text-xs text-left transition-all ${
                        active
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                          : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                      }`}
                    >
                      {profile.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-cyan-700">
                A &quot;Jarvis&quot; voice (British male) is created automatically on first use.
                Clone your own in the Voicebox app and it will appear here.
              </p>
            )}
            <p className="text-[10px] text-cyan-700">
              The selected Voicebox profile stays the same when you switch the brain between Claude and OpenAI.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Speaking Speed</label>
              <span className="text-xs font-mono text-cyan-300">
                {(settings.voicePlaybackRate ?? 0.8).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min="0.7"
              max="1"
              step="0.05"
              value={settings.voicePlaybackRate ?? 0.8}
              onChange={(e) => setSettings({ ...settings, voicePlaybackRate: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
            <p className="text-xs text-cyan-700">Slows the cloned voice while preserving its pitch. Default: 0.80×.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">First Message <span className="text-cyan-700 normal-case font-normal">(optional)</span></label>
            <input
              type="text"
              value={settings.localFirstMessage ?? ''}
              onChange={(e) => setSettings({ ...settings, localFirstMessage: e.target.value })}
              placeholder="Good evening, sir. All systems online."
              className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
            />
            <p className="text-xs text-cyan-700">Spoken when the session starts. Leave empty for silence.</p>
          </div>
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
  );
}
