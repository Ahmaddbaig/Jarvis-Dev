'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface CompanionView {
  id: string;
  name: string;
  address: string;
  platform: string;
  arch: string;
  pairedAt: string;
  online: boolean;
  paused?: boolean;
  hostname?: string;
  screen?: { width: number; height: number };
  error?: string;
}

interface CompanionListResponse {
  devices?: CompanionView[];
  error?: string;
}

export interface PairCompanionInput {
  address: string;
  code: string;
  fingerprint: string;
}

export interface CompanionPreviewFrame {
  mimeType: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  screen: number;
  capturedAt: string;
  imageBase64: string;
}

export function useCompanionPreview(target: string, screen: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.companions.preview(target, screen),
    queryFn: async ({ signal }) => {
      const response = await desktopControlFetch(
        `/api/companions/preview?target=${encodeURIComponent(target)}&screen=${screen}`,
        { cache: 'no-store', signal },
      );
      const data = await response.json() as CompanionPreviewFrame & { error?: string };
      if (!response.ok) throw new Error(data.error || `Preview failed with HTTP ${response.status}.`);
      return data;
    },
    enabled: enabled && Boolean(target),
    staleTime: 0,
    gcTime: 5_000,
    structuralSharing: false,
    refetchInterval: enabled && target ? 1_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useCompanions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.companions.list(),
    queryFn: async ({ signal }) => {
      const response = await desktopControlFetch('/api/companions', { cache: 'no-store', signal });
      const data = await response.json() as CompanionListResponse;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data.devices ?? [];
    },
    enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function usePairCompanion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PairCompanionInput) => {
      const response = await desktopControlFetch('/api/companions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pair', ...input }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.companions.all });
    },
  });
}

export function useRemoveCompanion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await desktopControlFetch('/api/companions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.companions.all });
    },
  });
}
