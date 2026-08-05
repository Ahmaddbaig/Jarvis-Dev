'use client';

import type { JarvisSettings } from '@jarvis/contracts';
import { FUNCTION_REGISTRY } from '@/frontend/lib/functions';
import type { JarvisFunction } from '@/frontend/lib/tools/types';
import { sfx } from '@/frontend/lib/sfx';
import { IntegrationsSettingsSection } from './IntegrationsSettingsSection';
import { AbilityRow } from './AbilityRow';

export function AbilitiesSettingsSection({
  settings,
  dynamicFunctions,
  onChange,
}: {
  settings: JarvisSettings;
  dynamicFunctions: JarvisFunction[];
  onChange: (settings: JarvisSettings) => void;
}) {
  const toggle = (name: string) => {
    sfx('click_sfx', 0.5);
    const enabled = settings.enabledFunctions.includes(name);
    onChange({
      ...settings,
      enabledFunctions: enabled
        ? settings.enabledFunctions.filter((current) => current !== name)
        : [...settings.enabledFunctions, name],
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-cyan-600">
        Enable modules to give Jarvis access to real-time data and actions.
      </p>
      <div className="space-y-2">
        {FUNCTION_REGISTRY.map((fn) => (
          <AbilityRow
            key={fn.name}
            fn={fn}
            enabled={settings.enabledFunctions.includes(fn.name)}
            onToggle={() => toggle(fn.name)}
          />
        ))}
      </div>

      <IntegrationsSettingsSection
        settings={settings}
        functions={dynamicFunctions}
        onToggle={toggle}
      />
    </div>
  );
}
