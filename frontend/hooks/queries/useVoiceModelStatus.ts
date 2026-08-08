'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface BrainStatus {
  ok: boolean;
  error?: string;
}

export interface VoiceProfileStatus {
  ok: boolean;
  profiles: { id: string; name: string }[];
  error?: string;
}

export function useBrainStatus(provider: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.models.health(provider),
    queryFn: ({ signal }) => fetchJson<BrainStatus>(
      `/api/voice/chat?provider=${encodeURIComponent(provider)}`,
      {},
      signal,
    ),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useVoiceProfiles(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.models.voiceProfiles(),
    queryFn: ({ signal }) => fetchJson<VoiceProfileStatus>('/api/voice/profiles', {}, signal),
    enabled,
    staleTime: 30_000,
  });
}
