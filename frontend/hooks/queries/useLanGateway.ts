'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LanClientView, LanPairingCode, LanScope } from '@jarvis/contracts';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';
import { queryKeys } from '@/frontend/lib/query/keys';

interface LanGatewayState {
  pairing: LanPairingCode | null;
  clients: LanClientView[];
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ({ error?: unknown } & T) | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `LAN gateway returned HTTP ${response.status}.`);
  }
  return body as T;
}

export function useLanGatewayState(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.lanGateway.state(),
    queryFn: async ({ signal }) => parse<LanGatewayState>(await desktopControlFetch('/api/lan-gateway', {
      cache: 'no-store',
      signal,
    })),
    enabled,
    retry: false,
    staleTime: 5_000,
  });
}

export function useCreateLanPairing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scopes: readonly LanScope[]) => parse<{ pairing: LanPairingCode }>(
      await desktopControlFetch('/api/lan-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes }),
      }),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.lanGateway.all }),
  });
}

export function useRevokeLanClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => parse<{ revoked: boolean }>(await desktopControlFetch('/api/lan-gateway', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.lanGateway.all }),
  });
}
