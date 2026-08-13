'use client';

import { useState } from 'react';
import type {
  JarvisGrid,
  JarvisLogo,
  JarvisPosition,
  JarvisSettings,
  JarvisTheme,
  JarvisVisualizer,
} from '@jarvis/contracts';
import { sfx } from '@/frontend/lib/sfx';
import { hashPin } from '@/frontend/lib/pin';

const THEMES: { id: JarvisTheme; name: string; accent: string; glow: string }[] = [
  { id: 'arc-reactor', name: 'Arc Reactor', accent: '#22d3ee', glow: 'rgba(34,211,238,0.4)' },
  { id: 'midnight', name: 'Midnight', accent: '#a855f7', glow: 'rgba(168,85,247,0.4)' },
  { id: 'crimson', name: 'Crimson', accent: '#ef4444', glow: 'rgba(239,68,68,0.4)' },
  { id: 'matrix', name: 'Matrix', accent: '#22c55e', glow: 'rgba(34,197,94,0.4)' },
];

const GRID_OPTIONS: { id: JarvisGrid; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

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

export function InterfaceSettingsSection({
  settings,
  onChange,
}: {
  settings: JarvisSettings;
  onChange: (settings: JarvisSettings) => void;
}) {
  const [newPin, setNewPin] = useState('');

  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Theme</label>
        <div className="grid grid-cols-2 gap-3">
          {THEMES.map((theme) => {
            const active = settings.theme === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => { sfx('select', 0.5); onChange({ ...settings, theme: theme.id }); }}
                className={`relative flex items-center gap-3 px-4 py-3 rounded border transition-all text-left ${
                  active
                    ? 'border-white/30 bg-white/5'
                    : 'border-white/10 bg-transparent hover:border-white/20'
                }`}
                style={active ? { boxShadow: `0 0 12px ${theme.glow}` } : {}}
              >
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

      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Background Grid</label>
        <div className="grid grid-cols-4 gap-2">
          {GRID_OPTIONS.map((option) => {
            const active = settings.grid === option.id;
            return (
              <button
                key={option.id}
                onClick={() => { sfx('click_sfx', 0.4); onChange({ ...settings, grid: option.id }); }}
                className={`px-3 py-2 border rounded text-xs uppercase tracking-wide transition-all ${
                  active
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Visualizer</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {VISUALIZERS.map((v) => {
            const active = settings.visualizer === v.id;
            return (
              <button
                key={v.id}
                onClick={() => { sfx('select', 0.5); onChange({ ...settings, visualizer: v.id }); }}
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

      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Center Logo</label>
        <div className="grid grid-cols-2 gap-2">
          {LOGOS.map((l) => {
            const active = (settings.logo ?? 'logo') === l.id;
            return (
              <button
                key={l.id}
                onClick={() => { sfx('select', 0.5); onChange({ ...settings, logo: l.id }); }}
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

      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Boot & Idle</label>
        <div className="space-y-3 rounded border border-cyan-500/20 bg-cyan-950/10 px-3 py-3">
          <label className="flex items-center justify-between gap-3 text-xs text-cyan-300">
            <span>Skip intro animation on launch</span>
            <input
              type="checkbox"
              checked={settings.disableIntroAnimation ?? false}
              onChange={(e) => { sfx('click_sfx', 0.4); onChange({ ...settings, disableIntroAnimation: e.target.checked }); }}
              className="accent-cyan-400"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-cyan-300">Ambient mode after idle</span>
            <select
              value={String(settings.ambientAutoMinutes ?? 0)}
              onChange={(e) => { sfx('select', 0.5); onChange({ ...settings, ambientAutoMinutes: Number(e.target.value) }); }}
              className="bg-[#021118] border border-cyan-500/30 rounded px-2 py-1 text-cyan-100 text-xs font-mono focus:outline-none focus:border-cyan-400"
            >
              <option value="0">Never</option>
              <option value="5">5 min</option>
              <option value="10">10 min</option>
              <option value="20">20 min</option>
              <option value="30">30 min</option>
            </select>
          </div>
          <p className="text-[10px] leading-relaxed text-cyan-700">
            Ambient mode is a JARVIS screensaver — say &quot;ambient mode&quot; or press the palette
            (⌘K) to enter it manually; any input exits.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Interface Lock</label>
        <div className="space-y-3 rounded border border-cyan-500/20 bg-cyan-950/10 px-3 py-3">
          <label className="flex items-center justify-between gap-3 text-xs text-cyan-300">
            <span>Require a PIN to use Jarvis</span>
            <input
              type="checkbox"
              checked={settings.lockEnabled ?? false}
              onChange={(e) => { sfx('click_sfx', 0.4); onChange({ ...settings, lockEnabled: e.target.checked }); }}
              className="accent-cyan-400"
            />
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder={settings.lockPinHash ? 'PIN set — enter new to replace' : '4-8 digit PIN'}
              className="flex-1 bg-[#021118] border border-cyan-500/30 rounded px-3 py-1.5 text-cyan-100 text-xs font-mono focus:outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              disabled={newPin.length < 4}
              onClick={() => {
                sfx('select_confirm', 0.5);
                onChange({ ...settings, lockPinHash: hashPin(newPin) });
                setNewPin('');
              }}
              className="rounded border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition-all hover:bg-cyan-500/25 disabled:opacity-40"
            >
              Set PIN
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-cyan-300">Auto-lock after idle</span>
            <select
              value={String(settings.lockAutoMinutes ?? 0)}
              onChange={(e) => { sfx('select', 0.5); onChange({ ...settings, lockAutoMinutes: Number(e.target.value) }); }}
              className="bg-[#021118] border border-cyan-500/30 rounded px-2 py-1 text-cyan-100 text-xs font-mono focus:outline-none focus:border-cyan-400"
            >
              <option value="0">Never</option>
              <option value="5">5 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">1 hour</option>
            </select>
          </div>
          <p className="text-[10px] leading-relaxed text-cyan-700">
            Locking needs both the toggle and a PIN. Say &quot;lock the interface&quot;, use ⌘K, or wait
            for auto-lock; voice tools are gated while locked.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Position</label>
        <div className="grid grid-cols-3 gap-2">
          {POSITIONS.map((p) => {
            const active = (settings.position ?? 'center') === p.id;
            return (
              <button
                key={p.id}
                onClick={() => { sfx('select', 0.5); onChange({ ...settings, position: p.id }); }}
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
    </div>
  );
}
