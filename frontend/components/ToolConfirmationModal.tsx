'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import type { ToolConfirmationRequest } from '@/frontend/lib/tools/runtime';

interface ToolConfirmationModalProps {
  request: ToolConfirmationRequest | null;
  onResolve: (approved: boolean) => void;
}

const RISK_COPY: Record<string, string> = {
  'local-privileged': 'Runs with your full account privileges on this Mac.',
  'external-side-effect': 'Changes something outside Jarvis that will not undo itself.',
  'remote-control': 'Controls a paired device remotely.',
  'read-private': 'Reads private data from this device.',
  'credential-operation': 'Touches stored credentials.',
};

function formatArguments(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'No arguments.';
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

export function ToolConfirmationModal({ request, onResolve }: ToolConfirmationModalProps) {
  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      // Escape declines. There is deliberately no Enter-to-approve: approving
      // is the consequential direction and should take a real click.
      if (event.key === 'Escape') onResolve(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onResolve]);

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-black/90 border border-amber-500/50 rounded-lg shadow-[0_0_30px_rgba(245,158,11,0.2)] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-amber-500/30 bg-amber-950/30">
          <h2 className="text-lg font-bold text-amber-400 tracking-wider">CONFIRM ACTION</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-amber-100">
            Jarvis wants to run <span className="font-bold text-amber-300">{request.label}</span>.
          </p>
          {RISK_COPY[request.risk] && (
            <p className="text-xs text-amber-500/90">{RISK_COPY[request.risk]}</p>
          )}
          <pre className="max-h-40 overflow-auto rounded border border-amber-500/20 bg-black/60 p-3 text-xs text-amber-200/90 whitespace-pre-wrap break-words">
            {formatArguments(request.args)}
          </pre>
        </div>

        <div className="px-6 py-4 border-t border-amber-500/30 bg-amber-950/20 flex justify-end gap-3">
          <button
            onClick={() => onResolve(false)}
            className="px-4 py-2 text-sm text-amber-500 hover:text-amber-300 transition-colors uppercase tracking-wider"
          >
            Decline
          </button>
          <button
            onClick={() => onResolve(true)}
            className="px-6 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 rounded text-amber-300 uppercase tracking-wider font-bold transition-all"
          >
            Allow once
          </button>
        </div>
      </motion.div>
    </div>
  );
}
