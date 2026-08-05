'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { JarvisFunction } from '@/frontend/lib/tools/types';
import { sfx } from '@/frontend/lib/sfx';
import type { JarvisSettings } from '@jarvis/contracts';
import { InterfaceSettingsSection } from './settings/InterfaceSettingsSection';
import { AbilitiesSettingsSection } from './settings/AbilitiesSettingsSection';
import { ComputersSettingsSection } from './settings/ComputersSettingsSection';
import { SystemSettingsSection } from './settings/SystemSettingsSection';
import { JarvisSettingsSection } from './settings/JarvisSettingsSection';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: JarvisSettings) => void;
  initialSettings: JarvisSettings;
  dynamicFunctions?: JarvisFunction[];
}

export type { JarvisSettings } from '@jarvis/contracts';

type Tab = 'jarvis' | 'abilities' | 'computers' | 'ui' | 'system';

export function SettingsModal({ isOpen, onClose, onSave, initialSettings, dynamicFunctions = [] }: SettingsModalProps) {
  const [settings, setSettings] = useState<JarvisSettings>(initialSettings);
  const [activeTab, setActiveTab] = useState<Tab>('jarvis');

  useEffect(() => {
    if (isOpen) {
      setSettings(initialSettings);
      setActiveTab('jarvis');
    }
  }, [isOpen, initialSettings]);

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
            <JarvisSettingsSection settings={settings} onChange={setSettings} />
          )}

          {/* Abilities Tab */}
          {activeTab === 'abilities' && (
            <AbilitiesSettingsSection
              settings={settings}
              dynamicFunctions={dynamicFunctions}
              onChange={setSettings}
            />
          )}

          {/* Paired companion computers */}
          {activeTab === 'computers' && (
            <ComputersSettingsSection
              active={isOpen && activeTab === 'computers'}
              onViewComputer={onClose}
            />
          )}

          {/* System — terminal & computer use diagnostics / overrides */}
          {activeTab === 'system' && (
            <SystemSettingsSection settings={settings} onChange={setSettings} />
          )}

          {/* UI Tab */}
          {activeTab === 'ui' && (
            <InterfaceSettingsSection settings={settings} onChange={setSettings} />
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
