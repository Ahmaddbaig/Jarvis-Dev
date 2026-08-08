'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { LanScope } from '@jarvis/contracts';
import {
  useCreateLanPairing,
  useLanGatewayState,
  useRevokeLanClient,
} from '@/frontend/hooks/queries/useLanGateway';

const SCOPE_OPTIONS: ReadonlyArray<{ id: LanScope; label: string; description: string }> = [
  { id: 'read', label: 'Read', description: 'Dashboards, calendars, devices, weather, and status.' },
  { id: 'control', label: 'Control', description: 'Media, calendar, printer, task, and smart-home actions.' },
  { id: 'ai', label: 'AI', description: 'Voice, transcription, image, and model-backed requests.' },
  { id: 'settings', label: 'Settings', description: 'Change non-secret Jarvis settings.' },
];

interface GatewayInfo {
  available: boolean;
  url?: string;
  pairingUrl?: string;
  port: number;
}

const subscribeDesktopBridge = () => () => {};

export function LanGatewaySettingsSection() {
  const [info, setInfo] = useState<GatewayInfo | null>(null);
  const [scopes, setScopes] = useState<LanScope[]>(['read', 'control', 'ai']);
  const isDesktop = useSyncExternalStore(
    subscribeDesktopBridge,
    () => window.electron?.isElectron === true,
    () => false,
  );
  const stateQuery = useLanGatewayState(isDesktop);
  const createPairing = useCreateLanPairing();
  const revokeClient = useRevokeLanClient();
  const state = stateQuery.data;
  const activeClients = useMemo(
    () => state?.clients.filter((client) => !client.revokedAt) ?? [],
    [state?.clients],
  );
  const error = stateQuery.error || createPairing.error || revokeClient.error;

  useEffect(() => {
    if (isDesktop) void window.electron?.getLanGatewayInfo?.().then(setInfo);
  }, [isDesktop]);

  function toggleScope(scope: LanScope) {
    setScopes((current) => current.includes(scope)
      ? current.filter((candidate) => candidate !== scope)
      : [...current, scope]);
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Revoke LAN access for ${name}? Its current browser session will stop immediately.`)) return;
    await revokeClient.mutateAsync(id).catch(() => undefined);
  }

  if (!isDesktop) return null;

  return (
    <div className="space-y-3 border border-cyan-500/25 bg-cyan-950/15 rounded p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Paired LAN Access</h3>
          <p className="text-[10px] text-cyan-700 mt-1 leading-relaxed">
            Browsers must pair before they can load Jarvis. Each browser receives only the scopes selected below;
            desktop control, shell, credentials, Chrome, companions, and process management are never exposed.
          </p>
        </div>
        <span className={`text-[10px] uppercase tracking-wider ${info?.available ? 'text-emerald-400' : 'text-amber-400'}`}>
          {info?.available ? 'Listening' : 'Unavailable'}
        </span>
      </div>

      {info?.pairingUrl && (
        <div className="space-y-2">
          <p className="text-[10px] text-cyan-300 font-mono break-all border border-cyan-500/15 bg-black/30 rounded p-2">
            {info.pairingUrl}
          </p>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(info.pairingUrl!)}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            Copy pairing URL
          </button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {SCOPE_OPTIONS.map((scope) => (
          <button
            type="button"
            key={scope.id}
            onClick={() => toggleScope(scope.id)}
            className={`text-left rounded border p-2 transition-colors ${scopes.includes(scope.id)
              ? 'border-cyan-400/60 bg-cyan-500/10'
              : 'border-cyan-500/15 bg-black/20 opacity-60'}`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-widest text-cyan-300">{scope.label}</span>
            <span className="block text-[9px] text-cyan-700 mt-1 leading-relaxed">{scope.description}</span>
          </button>
        ))}
      </div>

      {state?.pairing && (
        <div className="border border-amber-400/30 bg-amber-500/5 rounded p-3 text-center">
          <p className="text-[10px] text-amber-300 uppercase tracking-widest">One-time LAN pairing code</p>
          <p className="text-2xl text-amber-200 font-mono tracking-[0.3em] ml-[0.3em] mt-1">{state.pairing.code}</p>
          <p className="text-[9px] text-amber-500/70 mt-1">
            Expires {new Date(state.pairing.expiresAt).toLocaleTimeString()} · {state.pairing.scopes.join(', ')}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void createPairing.mutateAsync(scopes).catch(() => undefined)}
        disabled={createPairing.isPending || scopes.length === 0 || !info?.available}
        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
      >
        {createPairing.isPending ? 'Generating…' : 'Generate LAN code'}
      </button>

      <div className="border-t border-cyan-500/10 pt-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-500">
          Paired browsers ({activeClients.length})
        </p>
        {activeClients.length === 0 && <p className="text-[10px] text-cyan-800">No active LAN browsers.</p>}
        {activeClients.map((client) => (
          <div key={client.id} className="flex items-center justify-between gap-3 rounded border border-cyan-500/10 bg-black/20 p-2">
            <div className="min-w-0">
              <p className="text-[10px] text-cyan-200 truncate">{client.name}</p>
              <p className="text-[9px] text-cyan-700 truncate">
                {client.scopes.join(', ')} · last seen {new Date(client.lastSeenAt || client.pairedAt).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void revoke(client.id, client.name)}
              disabled={revokeClient.isPending}
              className="px-2 py-1 text-[9px] uppercase tracking-wider border border-red-500/30 text-red-300 rounded hover:bg-red-500/10 disabled:opacity-40"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-[10px] text-red-400 font-mono">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
    </div>
  );
}
