'use client';

import { useCallback, useEffect, useState } from 'react';
import { chromeControlFetch } from '@/frontend/lib/chromeControlClient';

interface ChromeControlStatus {
  paired: boolean;
  connected: boolean;
  extensionName?: string;
  pairedAt?: string;
  lastSeen?: string;
  extensionPath: string;
  supportedEndpoints: string[];
}

export function ChromeSettingsSection() {
  const [status, setStatus] = useState<ChromeControlStatus | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await chromeControlFetch('/api/chrome-control');
      if (!response.ok) throw new Error(`Chrome status returned HTTP ${response.status}.`);
      setStatus(await response.json() as ChromeControlStatus);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    chromeControlFetch('/api/chrome-control')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Chrome status returned HTTP ${response.status}.`);
        return response.json() as Promise<ChromeControlStatus>;
      })
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
          setError(null);
        }
      })
      .catch((refreshError) => {
        if (!cancelled) setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      });
    return () => { cancelled = true; };
  }, []);

  async function createPairing() {
    setBusy(true);
    setError(null);
    try {
      const response = await chromeControlFetch('/api/chrome-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'create_pairing' }),
      });
      const data = await response.json() as { code?: string; expiresAt?: string; error?: string };
      if (!response.ok || !data.code || !data.expiresAt) {
        throw new Error(data.error || 'Jarvis could not generate a pairing code.');
      }
      setPairing({ code: data.code, expiresAt: data.expiresAt });
      await refreshStatus();
    } catch (pairingError) {
      setError(pairingError instanceof Error ? pairingError.message : String(pairingError));
    } finally {
      setBusy(false);
    }
  }

  async function revokePairing() {
    if (!window.confirm('Revoke the paired Jarvis Chrome extension? Chrome control will stop immediately.')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await chromeControlFetch('/api/chrome-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'revoke_pairing' }),
      });
      if (!response.ok) throw new Error(`Chrome revoke returned HTTP ${response.status}.`);
      setPairing(null);
      await refreshStatus();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : String(revokeError));
    } finally {
      setBusy(false);
    }
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
          onClick={() => void refreshStatus()}
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
