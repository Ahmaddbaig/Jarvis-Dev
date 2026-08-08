'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AIEngineJob, AIEngineModelAction, AIEngineModels } from '@jarvis/contracts';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface AIEngineHealth {
  ok: boolean;
  protocol?: string;
  engineVersion?: string;
  buildSha?: string;
  python?: string;
  runtime?: { platform?: string; architecture?: string; memoryBytes?: number | null; frozen?: boolean };
  providers?: {
    localai?: {
      installed?: boolean;
      installedProfile?: string | null;
      ready?: boolean;
      ownedProcess?: boolean;
      warmProfile?: string | null;
      lastLoadSeconds?: number | null;
      manifest?: { state?: string; manifestId?: string; files?: number; totalBytes?: number } | null;
    };
    openai?: { configured?: boolean; requiredToBoot?: boolean };
  };
  error?: string;
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `AI engine request returned HTTP ${response.status}.`;
}

export function useAIEngineHealth() {
  return useQuery({
    queryKey: queryKeys.models.aiEngineHealth(),
    queryFn: ({ signal }) => fetchJson<AIEngineHealth>('/api/ai-engine/health', { cache: 'no-store' }, signal),
    retry: false,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useAIEngineModels() {
  return useQuery({
    queryKey: queryKeys.models.aiEngineProfiles(),
    queryFn: ({ signal }) => fetchJson<AIEngineModels>('/api/ai-engine/models', { cache: 'no-store' }, signal),
    retry: false,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useAIEngineAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: AIEngineModelAction) => {
      const response = await desktopControlFetch('/api/ai-engine/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<AIEngineJob>;
    },
    onSuccess: (job) => queryClient.setQueryData(queryKeys.models.aiEngineJob(job.id), job),
  });
}

export function useAIEngineJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.models.aiEngineJob(jobId),
    queryFn: async ({ signal }) => {
      const response = await desktopControlFetch(`/api/ai-engine/jobs/${jobId}`, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<AIEngineJob>;
    },
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state && ['succeeded', 'failed', 'cancelled'].includes(state) ? false : 750;
    },
  });
}

export function useCancelAIEngineJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const response = await desktopControlFetch(`/api/ai-engine/jobs/${jobId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<AIEngineJob>;
    },
    onSuccess: (job) => queryClient.setQueryData(queryKeys.models.aiEngineJob(job.id), job),
  });
}
