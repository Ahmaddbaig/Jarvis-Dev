'use client';

import type { JarvisGrid, JarvisSettings, JarvisTheme } from '@jarvis/contracts';
import { sfx } from '@/frontend/lib/sfx';

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

const MAIN_SCREENS: { id: 'hud' | 'galaxy'; name: string; desc: string }[] = [
  { id: 'hud', name: 'Arc Reactor HUD', desc: 'Classic ring visualizer and status readout' },
  { id: 'galaxy', name: 'Knowledge Galaxy', desc: '3D star map of your markdown notes — widgets float on top' },
];

export function InterfaceSettingsSection({
  settings,
  onChange,
}: {
  settings: JarvisSettings;
  onChange: (settings: JarvisSettings) => void;
}) {
  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Main Screen</label>
        <div className="grid grid-cols-2 gap-3">
          {MAIN_SCREENS.map((screen) => {
            const active = (settings.mainScreen ?? 'hud') === screen.id;
            return (
              <button
                key={screen.id}
                onClick={() => { sfx('select', 0.5); onChange({ ...settings, mainScreen: screen.id }); }}
                className={`relative px-4 py-3 rounded border transition-all text-left ${
                  active
                    ? 'border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                    : 'border-white/10 bg-transparent hover:border-white/20'
                }`}
              >
                <span className={`block text-sm font-semibold tracking-wide ${active ? 'text-white' : 'text-white/50'}`}>
                  {screen.name}
                </span>
                <span className="block mt-1 text-[11px] text-white/40 leading-snug">{screen.desc}</span>
                {active && (
                  <span className="absolute top-1.5 right-2 text-[10px] text-white/40 font-mono uppercase">
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-cyan-700">
          You can also just ask: &quot;Jarvis, show my knowledge galaxy&quot; / &quot;back to the HUD&quot;.
        </p>
      </div>

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
    </div>
  );
}
