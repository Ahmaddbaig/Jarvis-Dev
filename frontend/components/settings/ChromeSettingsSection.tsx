'use client';

import { useState } from 'react';
import {
  useChromeStatus,
  useCreateChromePairing,
  useRevokeChromePairing,
  type ChromePairing,
} from '@/frontend/hooks/queries/useChromeControl';

export function ChromeSettingsSection() {
  const [pairing, setPairing] = useState<ChromePairing | null>(null);
  const statusQuery = useChromeStatus();
  const createPairingMutation = useCreateChromePairing();
  const revokePairingMutation = useRevokeChromePairing();
  const status = statusQuery.data;
  const busy = createPairingMutation.isPending || revokePairingMutation.isPending;
  const requestError = createPairingMutation.error || revokePairingMutation.error || statusQuery.error;
  const error = requestError instanceof Error ? requestError.message : requestError ? String(requestError) : null;

  async function createPairing() {
    try {
      setPairing(await createPairingMutation.mutateAsync());
    } catch { /* mutation state renders the error */ }
  }

  async function revokePairing() {
    if (!window.confirm('Revoke the paired Jarvis Chrome extension? Chrome control will stop immediately.')) return;
    try {
      await revokePairingMutation.mutateAsync();
      setPairing(null);
    } catch { /* mutation state renders the error */ }
  }

  return (
    <div className="space-y-3 border border-cyan-500/25 bg-cyan-950/15 rounded p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Chrome Control Extension</h3>
          <p className="text-[10px] text-cyan-700 mt-1 leading-relaxed">
            Pair the local extension, then approve each website from Chrome before Jarvis may read or control it.
          </p>
        </div>
        <span className={`text-[10px] uppercase tracking-wider ${status?.connected ? 'text-emerald-400' : status?.paired ? 'text-amber-400' : 'text-cyan-700'}`}>
          {status?.connected ? 'Connected' : status?.paired ? 'Paired / Offline' : 'Not paired'}
        </span>
      </div>

      <ol className="list-decimal pl-4 text-[10px] text-cyan-600 leading-relaxed space-y-1">
        <li>Open <span className="text-cyan-300 font-mono">chrome://extensions</span> and turn on Developer mode.</li>
        <li>Select Load unpacked and choose the extension folder shown below.</li>
        <li>Generate a code here, open the JARVIS extension, and enter the code.</li>
        <li>Enable Chrome Use under Abilities and approve websites from the extension popup.</li>
      </ol>

      {status?.extensionPath && (
        <div className="space-y-2">
          <p className="text-[10px] text-cyan-300 font-mono break-all border border-cyan-500/15 bg-black/30 rounded p-2">
            {status.extensionPath}
          </p>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(status.extensionPath)}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            Copy extension path
          </button>
        </div>
      )}

      {pairing && (
        <div className="border border-amber-400/30 bg-amber-500/5 rounded p-3 text-center">
          <p className="text-[10px] text-amber-300 uppercase tracking-widest">Pairing code</p>
          <p className="text-2xl text-amber-200 font-mono tracking-[0.3em] ml-[0.3em] mt-1">{pairing.code}</p>
          <p className="text-[9px] text-amber-500/70 mt-1">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void createPairing()}
          disabled={busy}
          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Generate pairing code'}
        </button>
        <button
          type="button"
          onClick={() => void statusQuery.refetch()}
          disabled={busy}
          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50"
        >
          Refresh status
        </button>
        {status?.paired && (
          <button
            type="button"
            onClick={() => void revokePairing()}
            disabled={busy}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      </div>

      {status?.lastSeen && (
        <p className="text-[9px] text-cyan-800">Last extension contact: {new Date(status.lastSeen).toLocaleString()}</p>
      )}
      {error && <p className="text-[10px] text-red-400 font-mono">{error}</p>}
    </div>
  );
}
