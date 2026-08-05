'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GoogleServiceId } from '@/shared/google-services';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface GoogleServiceStatus {
  id: GoogleServiceId;
  label: string;
  shortLabel: string;
  serverName: string;
  configured: boolean;
  connected: boolean;
  tools: number;
  authenticated: boolean;
  tokenPath: string | null;
}

export interface GoogleServicesStatusResponse {
  hasCredentials: boolean;
  credentialsPath: string;
  services: GoogleServiceStatus[];
  error?: string;
}

export function googleServicesStatusQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.integrations.googleServices(),
    queryFn: async ({ signal }) => {
      const response = await fetchJson<GoogleServicesStatusResponse>('/api/mcp/google-services', {}, signal);
      if (response.error) throw new Error(response.error);
      return response;
    },
    staleTime: 10_000,
  });
}

export function useGoogleServicesStatus() {
  return useQuery(googleServicesStatusQueryOptions());
}

export function googleAuthStatusQueryOptions(serviceId: GoogleServiceId) {
  return queryOptions({
    queryKey: queryKeys.integrations.googleAuth(serviceId),
    queryFn: ({ signal }) => fetchJson<{ authenticated?: boolean; error?: string }>(
      `/api/mcp/auth-status?service=${encodeURIComponent(serviceId)}`,
      {},
      signal,
    ),
    staleTime: 0,
  });
}
