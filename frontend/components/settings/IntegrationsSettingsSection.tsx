'use client';

import type { JarvisSettings } from '@jarvis/contracts';
import type { JarvisFunction } from '@/frontend/lib/tools/types';
import { AbilityRow } from './AbilityRow';

interface IntegrationsSettingsSectionProps {
  settings: JarvisSettings;
  functions: JarvisFunction[];
  onToggle: (name: string) => void;
}

export function IntegrationsSettingsSection({
  settings,
  functions,
  onToggle,
}: IntegrationsSettingsSectionProps) {
  if (functions.length === 0) return null;

  return (
    <>
      <div className="mt-4 mb-2 border-t border-cyan-500/20 pt-4">
        <p className="text-xs font-bold text-cyan-500 uppercase tracking-widest">MCP &amp; Skills</p>
        <p className="text-[10px] text-cyan-700 mt-1">External tools loaded from configuration.</p>
      </div>
      {functions.map((fn) => (
        <AbilityRow
          key={fn.name}
          fn={fn}
          enabled={settings.enabledFunctions.includes(fn.name)}
          badge={fn.description.includes('MCP') ? 'MCP' : 'Skill'}
          onToggle={() => onToggle(fn.name)}
        />
      ))}
    </>
  );
}
