'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CredentialKey, CredentialPatch, CredentialStatus } from '@jarvis/contracts';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';
import { queryKeys } from '@/frontend/lib/query/keys';
import type { ServerSettings } from '@/frontend/lib/serverSettings';

interface CredentialStatusResponse {
  configured: CredentialStatus;
}

async function parseResponse(response: Response): Promise<CredentialStatusResponse> {
  const body = await response.json().catch(() => null) as (CredentialStatusResponse & { error?: unknown }) | null;
  if (!response.ok || !body) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Credential request returned HTTP ${response.status}.`);
  }
  return body;
}

export function useCredentialStatus() {
  return useQuery({
    queryKey: queryKeys.credentials.status(),
    queryFn: async ({ signal }) => parseResponse(await desktopControlFetch('/api/credentials', {
      cache: 'no-store',
      signal,
    })),
    staleTime: 15_000,
    retry: false,
  });
}

export function useSaveCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: CredentialPatch) => parseResponse(await desktopControlFetch('/api/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials }),
    })),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.credentials.status(), response);
      queryClient.setQueryData<ServerSettings>(queryKeys.settings.current(), (current) => ({
        ...(current ?? {}),
        credentialStatus: response.configured,
      }));
    },
  });
}

export function useDeleteCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (keys: readonly CredentialKey[]) => parseResponse(await desktopControlFetch('/api/credentials', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    })),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.credentials.status(), response);
      queryClient.setQueryData<ServerSettings>(queryKeys.settings.current(), (current) => ({
        ...(current ?? {}),
        credentialStatus: response.configured,
      }));
    },
  });
}
