'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AIEngineModelAction } from '@jarvis/contracts';
import {
  useAIEngineAction,
  useAIEngineHealth,
  useAIEngineJob,
  useAIEngineModels,
  useCancelAIEngineJob,
} from '@/frontend/hooks/queries/useAIEngine';
import { queryKeys } from '@/frontend/lib/query/keys';

function formatBytes(value?: number | null): string {
  if (!value) return 'Unknown';
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function AIEngineSettingsSection() {
  const queryClient = useQueryClient();
  const health = useAIEngineHealth();
  const models = useAIEngineModels();
  const action = useAIEngineAction();
  const cancel = useCancelAIEngineJob();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useAIEngineJob(jobId);
  const installed = models.data?.profiles.find((profile) => profile.installed);
  const activeJob = job.data;
  const jobRunning = activeJob?.state === 'queued' || activeJob?.state === 'running';

  useEffect(() => {
    if (activeJob && ['succeeded', 'failed', 'cancelled'].includes(activeJob.state)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models.aiEngineProfiles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.models.aiEngineHealth() });
    }
  }, [activeJob?.state, activeJob, queryClient]);

  async function run(request: AIEngineModelAction) {
    const created = await action.mutateAsync(request);
    setJobId(created.id);
  }

  const error = health.error || models.error || action.error || job.error || cancel.error;
  const localAI = health.data?.providers?.localai;

  return (
    <div className="space-y-3 border border-cyan-500/25 bg-cyan-950/15 rounded p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">AI Engine</h3>
          <p className="text-[10px] text-cyan-700 mt-1 leading-relaxed">
            The authenticated local sidecar supervises only the installed M2, M3, or M5 profile. Realtime voice media stays on the direct LocalAI WebRTC path.
          </p>
        </div>
        <span className={`text-[10px] uppercase tracking-wider ${health.data?.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
          {health.isFetching && !health.data ? 'Checking' : health.data?.ok ? 'Engine ready' : 'Unavailable'}
        </span>
      </div>

      {health.data?.ok && (
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-cyan-300">
          <span>Protocol: {health.data.protocol}</span>
          <span>Python: {health.data.python}</span>
          <span>Runtime: {health.data.runtime?.platform}/{health.data.runtime?.architecture}</span>
          <span>Memory: {formatBytes(health.data.runtime?.memoryBytes)}</span>
        </div>
      )}

      {installed ? (
        <div className="border-t border-cyan-500/10 pt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-cyan-200">{installed.label}</div>
              <div className="text-[10px] text-cyan-700">
                {installed.hardware} · expected {formatBytes(installed.expectedDiskBytes)} disk
              </div>
            </div>
            <span className={`text-[10px] uppercase ${installed.warm ? 'text-emerald-400' : localAI?.ready ? 'text-cyan-400' : 'text-amber-400'}`}>
              {installed.warm ? 'Warm' : localAI?.ready ? 'Server ready' : 'Cold'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void run({ action: 'validate', profile: installed.id })}
              disabled={action.isPending || jobRunning}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40"
            >
              Validate
            </button>
            <button
              type="button"
              onClick={() => void run({ action: 'warm', profile: installed.id })}
              disabled={action.isPending || jobRunning || installed.warm}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
            >
              Warm Profile
            </button>
            <button
              type="button"
              onClick={() => void run({ action: 'unload', profile: installed.id })}
              disabled={action.isPending || jobRunning || !installed.warm}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-40"
            >
              Unload
            </button>
          </div>
        </div>
      ) : models.data ? (
        <p className="text-[10px] text-amber-400 border-t border-cyan-500/10 pt-3">
          No supported LocalAI profile is installed. The engine will not auto-download or substitute a model.
        </p>
      ) : null}

      {activeJob && (
        <div className="border-t border-cyan-500/10 pt-3 space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-cyan-300">{activeJob.kind} · {activeJob.message}</span>
            <span className="text-cyan-500">{Math.round(activeJob.progress * 100)}%</span>
          </div>
          <div className="h-1.5 rounded bg-black/40 overflow-hidden">
            <div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.max(2, activeJob.progress * 100)}%` }} />
          </div>
          {jobRunning && (
            <button
              type="button"
              onClick={() => void cancel.mutateAsync(activeJob.id)}
              disabled={cancel.isPending}
              className="text-[10px] uppercase tracking-wider text-amber-400 hover:text-amber-300 disabled:opacity-40"
            >
              Cancel job
            </button>
          )}
          {activeJob.error && <p className="text-[10px] text-red-400 font-mono">{activeJob.error}</p>}
        </div>
      )}

      {localAI?.manifest && (
        <p className="text-[10px] text-cyan-700 font-mono border-t border-cyan-500/10 pt-3">
          Manifest {localAI.manifest.state} · {localAI.manifest.files} files · {formatBytes(localAI.manifest.totalBytes)}
        </p>
      )}
      {error && <p className="text-[10px] text-red-400 font-mono">{error instanceof Error ? error.message : String(error)}</p>}
    </div>
  );
}
