'use client';

import { sfx } from '@/frontend/lib/sfx';
import { DEFAULT_JARVIS_PERSONA } from '@/frontend/lib/voiceSession';
import type { JarvisSettingsDraft } from '../SettingsModal';

interface PersonaSettingsSectionProps {
  settings: JarvisSettingsDraft;
  onChange: (settings: JarvisSettingsDraft) => void;
}

/**
 * Personality and recognition hints, shared by every voice engine and the
 * typed chat panel.
 */
export function PersonaSettingsSection({ settings, onChange }: PersonaSettingsSectionProps) {
  const isDefaultPersona = settings.initialPrompt.trim() === DEFAULT_JARVIS_PERSONA;

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
            Personality Protocol
          </label>
          {!isDefaultPersona && (
            <button
              type="button"
              onClick={() => {
                sfx('click', 0.5);
                onChange({ ...settings, initialPrompt: DEFAULT_JARVIS_PERSONA });
              }}
              className="text-[10px] uppercase tracking-wider text-cyan-600 hover:text-cyan-300 transition-colors"
            >
              Reset to default
            </button>
          )}
        </div>
        <textarea
          value={settings.initialPrompt}
          onChange={(e) => onChange({ ...settings, initialPrompt: e.target.value })}
          rows={10}
          className="w-full resize-y bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm leading-relaxed"
        />
        <p className="text-[10px] leading-relaxed text-cyan-700">
          Defines who Jarvis is for every voice engine and the typed chat. The default is the
          movie-grade protocol: composed, dryly witty, decisive. Session context (date, time)
          is added automatically.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
          Speech Vocabulary
        </label>
        <textarea
          value={settings.speechVocabulary ?? ''}
          onChange={(e) => onChange({ ...settings, speechVocabulary: e.target.value })}
          placeholder="Skillet, Ahmad, Bambu Lab, project names, device names…"
          rows={3}
          maxLength={1000}
          className="w-full resize-y bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
        />
        <p className="text-[10px] leading-relaxed text-cyan-700">
          Names, artists, applications, devices, acronyms, and technical terms — separated by
          commas or new lines. Every engine uses them as recognition hints so Jarvis hears
          unusual words correctly.
        </p>
      </div>
    </div>
  );
}
