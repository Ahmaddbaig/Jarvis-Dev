'use client';

import { useState } from 'react';
import { sfx } from '@/frontend/lib/sfx';
import {
  useCompanions,
  usePairCompanion,
  useRemoveCompanion,
  type CompanionView,
} from '@/frontend/hooks/queries/useCompanions';

interface ComputersSettingsSectionProps {
  active: boolean;
  onViewComputer: () => void;
}

export function ComputersSettingsSection({ active, onViewComputer }: ComputersSettingsSectionProps) {
  const [companionAddress, setCompanionAddress] = useState('');
  const [companionCode, setCompanionCode] = useState('');
  const [companionFingerprint, setCompanionFingerprint] = useState('');
  const [companionMessage, setCompanionMessage] = useState<string | null>(null);
  const companionsQuery = useCompanions(active);
  const pairCompanionMutation = usePairCompanion();
  const removeCompanionMutation = useRemoveCompanion();
  const companions = companionsQuery.data ?? [];
  const companionBusy = companionsQuery.isFetching
    || pairCompanionMutation.isPending
    || removeCompanionMutation.isPending;
  const requestError = companionsQuery.error || pairCompanionMutation.error || removeCompanionMutation.error;
  const requestMessage = requestError instanceof Error ? requestError.message : requestError ? String(requestError) : null;

  async function pairComputer() {
    setCompanionMessage(null);
    try {
      await pairCompanionMutation.mutateAsync({
        address: companionAddress.trim(),
        code: companionCode.trim(),
        fingerprint: companionFingerprint.trim(),
      });
      setCompanionCode('');
      setCompanionFingerprint('');
      setCompanionMessage('Computer paired securely.');
    } catch { /* mutation state renders the error */ }
  }

  async function removeComputer(id: string) {
    setCompanionMessage(null);
    try {
      await removeCompanionMutation.mutateAsync(id);
      setCompanionMessage('Computer removed from Jarvis.');
    } catch { /* mutation state renders the error */ }
  }

  function viewComputer(device: CompanionView) {
    sfx('click_sfx', 0.5);
    window.dispatchEvent(new CustomEvent('jarvis:hud', {
      detail: {
        command: 'open',
        widget: 'companion-display',
        title: `${device.name} Display`,
        widget_config: { target: device.id, name: device.name, screen: 0 },
      },
    }));
    onViewComputer();
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Pair a Computer</h3>
        <p className="text-[11px] text-cyan-700 mt-1 leading-relaxed">
          Start Jarvis Companion on the Mac or Windows PC you want to control, then copy the address,
          six-digit code, and certificate fingerprint shown there. Both computers must be on the same private network.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Companion Address</span>
          <input
            type="text"
            value={companionAddress}
            onChange={(event) => setCompanionAddress(event.target.value)}
            placeholder="https://192.168.1.20:45831"
            className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Pairing Code</span>
          <input
            type="text"
            inputMode="numeric"
            value={companionCode}
            onChange={(event) => setCompanionCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm tracking-[0.3em]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">TLS Fingerprint</span>
          <input
            type="text"
            value={companionFingerprint}
            onChange={(event) => setCompanionFingerprint(event.target.value)}
            placeholder="a1b2-c3d4-e5f6-7890"
            className="w-full bg-[#021118] border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void pairComputer()}
        disabled={companionBusy || !companionAddress.trim() || companionCode.length !== 6 || !companionFingerprint.trim()}
        className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
      >
        {companionBusy ? 'Connecting…' : 'Pair Computer'}
      </button>

      {(companionMessage || requestMessage) && (
        <p className="text-xs text-cyan-300 border border-cyan-500/20 bg-cyan-950/20 rounded px-3 py-2">
          {companionMessage || requestMessage}
        </p>
      )}

      <div className="border-t border-cyan-500/20 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Paired Computers</h3>
            <p className="text-[10px] text-cyan-700 mt-1">The companion must stay running while Jarvis controls that computer.</p>
          </div>
          <button
            type="button"
            onClick={() => { setCompanionMessage(null); void companionsQuery.refetch(); }}
            disabled={companionBusy}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-40"
          >
            Refresh
          </button>
        </div>

        {companions.length === 0 ? (
          <p className="text-xs text-cyan-700 border border-dashed border-cyan-500/20 rounded px-4 py-5 text-center">
            No companion computers paired yet.
          </p>
        ) : companions.map((device) => (
          <div key={device.id} className="border border-cyan-500/20 bg-cyan-950/10 rounded p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${device.online && !device.paused ? 'bg-emerald-400' : device.online ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <p className="text-sm font-semibold text-cyan-200 truncate">{device.name}</p>
                  <span className="text-[9px] uppercase border border-cyan-500/20 rounded px-1.5 py-0.5 text-cyan-600">
                    {device.platform}
                  </span>
                </div>
                <p className="text-[10px] text-cyan-700 font-mono mt-1 break-all">{device.address}</p>
              </div>
              <button
                type="button"
                onClick={() => void removeComputer(device.id)}
                disabled={companionBusy}
                className="text-[10px] uppercase tracking-wider text-red-400/70 hover:text-red-300 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
            <p className="text-[10px] text-cyan-600">
              {!device.online
                ? `Offline${device.error ? ` — ${device.error}` : ''}`
                : device.paused
                  ? 'Online — control paused from the companion tray'
                  : `Ready${device.screen ? ` — ${device.screen.width}×${device.screen.height}` : ''}`}
            </p>
            <button
              type="button"
              onClick={() => viewComputer(device)}
              disabled={!device.online || device.paused}
              className="rounded border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-35"
            >
              View Display
            </button>
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-cyan-700 border border-cyan-500/20 bg-cyan-950/20 rounded px-3 py-2">
        In Abilities, enable <span className="text-cyan-400">Companion Computers</span> for launch, typing,
        keypress, and click commands. Enable <span className="text-cyan-400">Computer Use</span> for visual control.
        The live display and direct companion commands work with Local AI. The current visual Computer Use agent uses OpenAI.
      </p>
    </div>
  );
}
