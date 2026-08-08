'use client';

import type { JarvisFunction } from '@/frontend/lib/tools/types';

export function AbilityRow({
  fn,
  enabled,
  badge,
  onToggle,
}: {
  fn: JarvisFunction;
  enabled: boolean;
  badge?: 'MCP' | 'Skill';
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded border border-cyan-500/20 bg-cyan-950/10">
      <div className={badge ? 'flex-1 min-w-0' : undefined}>
        <div className={badge ? 'flex items-center gap-2' : undefined}>
          <p className="text-sm text-cyan-300 font-semibold">{fn.label}</p>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/30 uppercase font-mono">
              {badge}
            </span>
          )}
        </div>
        <p className={`text-xs text-cyan-600 mt-0.5 ${badge ? 'truncate' : ''}`}>{fn.description}</p>
      </div>
      <button
        onClick={onToggle}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ml-4 ${
          enabled ? 'bg-cyan-500' : 'bg-cyan-900/60'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}
