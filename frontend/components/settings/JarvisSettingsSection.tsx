'use client';

import { useEffect, useState } from 'react';
import type {
  CredentialKey,
  CredentialStatus,
  RealtimeModel,
} from '@jarvis/contracts';
import type { JarvisSettingsDraft } from '../SettingsModal';
import { sfx } from '@/frontend/lib/sfx';
import {
  DEFAULT_LOCAL_AI_BASE_URL,
  LOCAL_AI_PROFILES,
} from '@/frontend/lib/localAIProfiles';
import { useBrainStatus, useVoiceProfiles } from '@/frontend/hooks/queries/useVoiceModelStatus';

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
              voicebox: 'Cloud or local brain + same cloned voice',
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
              ● Brain ({brainProvider === 'claude' ? 'Claude API' : brainProvider === 'local' ? 'Ollama on this Mac' : 'OpenAI API'}) {brainStatus === null ? '— checking…' : brainStatus.ok ? 'ready' : `not ready — ${brainStatus.error ?? 'no API key'}`}
            </p>
            <p className={voiceboxStatus?.ok ? 'text-green-400' : 'text-red-400'}>
              ● Voice (Voicebox) {voiceboxStatus === null ? '— checking…' : voiceboxStatus.ok ? 'online' : `offline — ${voiceboxStatus.error ?? 'not reachable'}`}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Jarvis Voice</label>
            {voiceboxStatus?.ok && voiceboxStatus.profiles.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {voiceboxStatus.profiles.map((profile) => {
                  const active = (settings.voiceboxProfileId ?? '') === profile.id
                    || (!settings.voiceboxProfileId && profile.name === 'Jarvis');
                  const voiceDetail = [
                    profile.voiceType === 'cloned' ? 'custom cloned voice' : profile.voiceType,
                    profile.engine,
                    profile.voiceId,
                  ].filter(Boolean).join(' · ');
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
                      <span className="block">{profile.name}</span>
                      {voiceDetail && (
                        <span className="block mt-0.5 font-mono text-[10px] opacity-70">{voiceDetail}</span>
                      )}
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
              The voice itself lives in the Voicebox app: change a profile&apos;s voice there — preset
              or your own cloned voice — and Jarvis speaks with it. Same voice for every brain below.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Brain Provider</label>
            <select
              value={brainProvider}
              onChange={(e) => {
                sfx('select', 0.5);
                const provider = e.target.value === 'claude'
                  ? 'claude' as const
                  : e.target.value === 'local'
                    ? 'local' as const
                    : 'openai' as const;
                setSettings({
                  ...settings,
                  brainProvider: provider,
                  // Reset to the provider's default model so a GPT model
                  // is never sent to the Claude API or vice versa.
                  chatModel: provider === 'claude'
                    ? 'claude-haiku-4-5'
                    : provider === 'local'
                      ? 'qwen3.6:27b'
                      : 'gpt-4o-mini',
                });
              }}
              className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
            >
              <option value="openai" className="bg-slate-900">OpenAI (GPT)</option>
              <option value="claude" className="bg-slate-900">Claude (Anthropic)</option>
              <option value="local" className="bg-slate-900">Local (Ollama) — no API key</option>
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
              Brain Model ({brainProvider === 'claude' ? 'Claude' : brainProvider === 'local' ? 'Ollama' : 'OpenAI'})
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(brainProvider === 'claude'
                ? ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']
                : brainProvider === 'local'
                  ? (brainStatus?.models?.length ? brainStatus.models : ['qwen3.6:27b'])
                  : ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']
              ).map((model) => {
                const fallback = brainProvider === 'claude'
                  ? 'claude-haiku-4-5'
                  : brainProvider === 'local'
                    ? 'qwen3.6:27b'
                    : 'gpt-4o-mini';
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
              value={settings.chatModel ?? (brainProvider === 'claude' ? 'claude-haiku-4-5' : brainProvider === 'local' ? 'qwen3.6:27b' : 'gpt-4o-mini')}
              onChange={(e) => setSettings({ ...settings, chatModel: e.target.value })}
              placeholder={brainProvider === 'claude' ? 'claude-haiku-4-5' : brainProvider === 'local' ? 'qwen3.6:27b' : 'gpt-4o-mini'}
              className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
            />
            <p className="text-xs text-cyan-700">
              {brainProvider === 'claude'
                ? 'Uses the Claude API key above. Any Claude model with tool calling works.'
                : brainProvider === 'local'
                  ? 'Runs fully on this Mac through Ollama — no API key, no internet, no per-question cost. Pick a model with tool calling.'
                  : 'Uses the OpenAI API key above. Any chat model with tool calling works.'}
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

    </>
  );
}
