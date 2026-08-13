'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { JarvisFunction } from '@/frontend/lib/tools/types';
import { sfx } from '@/frontend/lib/sfx';
import type { CredentialKey, CredentialStatus, JarvisSettings } from '@jarvis/contracts';
import { InterfaceSettingsSection } from './settings/InterfaceSettingsSection';
import { AbilitiesSettingsSection } from './settings/AbilitiesSettingsSection';
import { ComputersSettingsSection } from './settings/ComputersSettingsSection';
import { SystemSettingsSection } from './settings/SystemSettingsSection';
import { JarvisSettingsSection } from './settings/JarvisSettingsSection';
import { PersonaSettingsSection } from './settings/PersonaSettingsSection';
import { useDeleteCredentials } from '@/frontend/hooks/queries/useCredentials';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: JarvisSettingsDraft) => Promise<void>;
  initialSettings: JarvisSettings;
  credentialStatus?: CredentialStatus;
  dynamicFunctions?: JarvisFunction[];
}

export type { JarvisSettings } from '@jarvis/contracts';
export type JarvisSettingsDraft = JarvisSettings & {
  apiKey?: string;
  claudeApiKey?: string;
};

type Tab = 'voice' | 'persona' | 'abilities' | 'computers' | 'ui' | 'system';

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'voice',     label: 'Voice',     desc: 'Engine, brain & speech'   },
  { id: 'persona',   label: 'Persona',   desc: 'Personality & vocabulary' },
  { id: 'ui',        label: 'Interface', desc: 'Theme, HUD & layout'      },
  { id: 'abilities', label: 'Abilities', desc: 'Tools Jarvis may use'     },
  { id: 'computers', label: 'Computers', desc: 'Paired companions'        },
  { id: 'system',    label: 'System',    desc: 'Diagnostics & overrides'  },
];

export function SettingsModal({ isOpen, onClose, onSave, initialSettings, credentialStatus, dynamicFunctions = [] }: SettingsModalProps) {
  const [settings, setSettings] = useState<JarvisSettingsDraft>({
    ...initialSettings,
    apiKey: '',
    claudeApiKey: '',
  });
  const [activeTab, setActiveTab] = useState<Tab>('voice');
  const [saving, setSaving] = useState(false);
  const deleteCredentials = useDeleteCredentials();

  const deleteCredential = async (key: CredentialKey) => {
    await deleteCredentials.mutateAsync([key]);
    if (key === 'openaiApiKey') setSettings((current) => ({ ...current, apiKey: '' }));
    if (key === 'anthropicApiKey') setSettings((current) => ({ ...current, claudeApiKey: '' }));
  };

  useEffect(() => {
    if (isOpen) {
      setSettings({ ...initialSettings, apiKey: '', claudeApiKey: '' });
      setActiveTab('voice');
    }
  }, [isOpen, initialSettings]);

  // Escape closes without saving, like every native settings window.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="flex h-[min(720px,88vh)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-cyan-500/50 bg-black/90"
        style={{ boxShadow: `0 0 30px var(--accent-glow)` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cyan-500/30 bg-cyan-950/30 px-6 py-4">
          <h2 className="text-xl font-bold tracking-wider text-cyan-400">SYSTEM CONFIGURATION</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-cyan-500 transition-colors hover:text-cyan-300"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar navigation */}
          <nav className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-cyan-500/20 bg-cyan-950/10 p-3">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { sfx('switch_interface', 0.5, 2); setActiveTab(tab.id); }}
                  className={`rounded border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                      : 'border-transparent hover:border-cyan-500/30 hover:bg-cyan-950/30'
                  }`}
                >
                  <span className={`block text-xs font-bold uppercase tracking-widest ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                    {tab.label}
                  </span>
                  <span className={`mt-0.5 block text-[10px] leading-tight ${active ? 'text-cyan-500' : 'text-white/25'}`}>
                    {tab.desc}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Content pane */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-cyan-500/10 px-6 py-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-600">
                {activeMeta.label}
              </span>
              <span className="ml-3 text-[10px] text-white/30">{activeMeta.desc}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
              {activeTab === 'voice' && (
                <JarvisSettingsSection
                  settings={settings}
                  credentialStatus={credentialStatus}
                  onChange={setSettings}
                  onDeleteCredential={deleteCredential}
                />
              )}

              {activeTab === 'persona' && (
                <PersonaSettingsSection settings={settings} onChange={setSettings} />
              )}

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

              {activeTab === 'ui' && (
                <InterfaceSettingsSection settings={settings} onChange={setSettings} />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-cyan-500/30 bg-cyan-950/30 px-6 py-4">
          <span className="text-[10px] uppercase tracking-widest text-cyan-800">
            Changes apply on save
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => { sfx('click', 0.5); onClose(); }}
              className="px-4 py-2 text-sm uppercase tracking-wider text-cyan-500 transition-colors hover:text-cyan-300"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                sfx('select_confirm', 0.6);
                setSaving(true);
                void onSave(settings).finally(() => setSaving(false));
              }}
              disabled={saving}
              className="rounded border border-cyan-500/50 bg-cyan-500/20 px-6 py-2 font-bold uppercase tracking-wider text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all hover:bg-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]"
            >
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
