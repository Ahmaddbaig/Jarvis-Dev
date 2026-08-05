'use client';

import { useEffect, useState } from 'react';
import type { JarvisSettings } from '@jarvis/contracts';
import { sfx } from '@/frontend/lib/sfx';
import { ChromeSettingsSection } from './ChromeSettingsSection';
import { LanGatewaySettingsSection } from './LanGatewaySettingsSection';
import { useSystemDiagnostics } from '@/frontend/hooks/queries/useSystemDiagnostics';
import {
  useCreateRecoveryExport,
  useStorageDiagnostics,
} from '@/frontend/hooks/queries/useStorageAdmin';

interface SystemSettingsSectionProps {
  settings: JarvisSettings;
  onChange: (settings: JarvisSettings) => void;
}

export function SystemSettingsSection({ settings, onChange }: SystemSettingsSectionProps) {
  const [macPermissions, setMacPermissions] = useState<MacPermissionStatus | null>(null);
  const [permissionBusy, setPermissionBusy] = useState<string | null>(null);
  const [isMacElectron, setIsMacElectron] = useState(false);
  const diagnosticsQuery = useSystemDiagnostics();
  const storageQuery = useStorageDiagnostics();
  const recoveryExport = useCreateRecoveryExport();
  const diagLoading = diagnosticsQuery.isFetching;
  const diagOutput = diagnosticsQuery.data === undefined
    ? null
    : JSON.stringify(diagnosticsQuery.data, null, 2);
  const diagError = diagnosticsQuery.error instanceof Error
    ? diagnosticsQuery.error.message
    : diagnosticsQuery.error ? String(diagnosticsQuery.error) : null;

  useEffect(() => {
    setIsMacElectron(window.electron?.platform === 'darwin');

    const refreshMacPermissions = () => {
      if (window.electron?.platform === 'darwin') {
        void window.electron.getMacPermissions?.().then(setMacPermissions);
      }
    };

    refreshMacPermissions();
    window.addEventListener('focus', refreshMacPermissions);
    return () => window.removeEventListener('focus', refreshMacPermissions);
  }, []);

  async function requestPermission(permission: 'accessibility' | 'screen' | 'microphone') {
    setPermissionBusy(permission);
    try {
      const status = await window.electron?.requestMacPermission?.(permission);
      if (status) setMacPermissions(status);
    } finally {
      setPermissionBusy(null);
    }
  }

  async function runDiagnostics() {
    sfx('click_sfx', 0.5);
    await diagnosticsQuery.refetch();
  }

  return (
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

      <ChromeSettingsSection />

      <LanGatewaySettingsSection />

      <div className="space-y-2">
        <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
          Shell path override
        </label>
        <input
          type="text"
          value={settings.shellPathOverride ?? ''}
          onChange={(event) => onChange({ ...settings, shellPathOverride: event.target.value })}
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
          onChange={(event) => onChange({ ...settings, pythonPathOverride: event.target.value })}
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
        {diagError && <p className="text-xs text-red-400 font-mono">{diagError}</p>}
        {diagOutput && (
          <pre className="text-[10px] leading-snug text-cyan-200/90 bg-black/50 border border-cyan-500/20 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre">
            {diagOutput}
          </pre>
        )}
      </div>

      <div className="space-y-3 border border-cyan-500/20 bg-cyan-950/10 rounded p-4">
        <div>
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Local Data Store</h3>
          <p className="text-[10px] text-cyan-700 mt-1 leading-relaxed">
            Verify the SQLite schema and create a recovery bundle before troubleshooting, upgrades, or rollback.
            Exports stay on this computer and never include raw credentials from the new database.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void storageQuery.refetch()}
            disabled={storageQuery.isFetching || typeof window === 'undefined' || window.electron?.isElectron !== true}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40"
          >
            {storageQuery.isFetching ? 'Checking…' : 'Check Storage'}
          </button>
          <button
            type="button"
            onClick={() => void recoveryExport.mutateAsync()}
            disabled={recoveryExport.isPending || typeof window === 'undefined' || window.electron?.isElectron !== true}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
          >
            {recoveryExport.isPending ? 'Exporting…' : 'Create Recovery Export'}
          </button>
        </div>
        {storageQuery.data && (
          <p className="text-[10px] text-cyan-300 font-mono break-all">
            Schema {storageQuery.data.schemaVersion}/{storageQuery.data.latestSchemaVersion} · {storageQuery.data.integrity}
            {' · '}{storageQuery.data.journalMode} · {storageQuery.data.path}
          </p>
        )}
        {recoveryExport.data && (
          <p className="text-[10px] text-emerald-400 font-mono break-all">
            Recovery files: {recoveryExport.data.files.database} and {recoveryExport.data.files.json}
          </p>
        )}
        {(storageQuery.error || recoveryExport.error) && (
          <p className="text-[10px] text-red-400 font-mono">
            {String(storageQuery.error instanceof Error ? storageQuery.error.message : recoveryExport.error instanceof Error ? recoveryExport.error.message : storageQuery.error || recoveryExport.error)}
          </p>
        )}
      </div>
    </div>
  );
}
