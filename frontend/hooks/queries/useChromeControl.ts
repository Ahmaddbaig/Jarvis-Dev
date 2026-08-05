'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chromeControlFetch } from '@/frontend/lib/chromeControlClient';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface ChromeControlStatus {
  paired: boolean;
  connected: boolean;
  extensionName?: string;
  pairedAt?: string;
  lastSeen?: string;
  extensionPath: string;
  supportedEndpoints: string[];
}

export interface ChromePairing {
  code: string;
  expiresAt: string;
}

async function getChromeStatus(signal?: AbortSignal): Promise<ChromeControlStatus> {
  const response = await chromeControlFetch('/api/chrome-control', { signal });
  if (!response.ok) throw new Error(`Chrome status returned HTTP ${response.status}.`);
  return response.json() as Promise<ChromeControlStatus>;
}

export function useChromeStatus() {
  return useQuery({
    queryKey: queryKeys.chrome.status(),
    queryFn: ({ signal }) => getChromeStatus(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useCreateChromePairing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ChromePairing> => {
      const response = await chromeControlFetch('/api/chrome-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'create_pairing' }),
      });
      const data = await response.json() as Partial<ChromePairing> & { error?: string };
      if (!response.ok || !data.code || !data.expiresAt) {
        throw new Error(data.error || 'Jarvis could not generate a pairing code.');
      }
      return { code: data.code, expiresAt: data.expiresAt };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chrome.all });
    },
  });
}

export function useRevokeChromePairing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await chromeControlFetch('/api/chrome-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'revoke_pairing' }),
      });
      if (!response.ok) throw new Error(`Chrome revoke returned HTTP ${response.status}.`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chrome.all });
    },
  });
}
