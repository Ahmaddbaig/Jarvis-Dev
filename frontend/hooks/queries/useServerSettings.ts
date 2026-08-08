'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchServerSettings,
  persistServerSettings,
  type ServerSettings,
} from '@/frontend/lib/serverSettings';
import { queryKeys } from '@/frontend/lib/query/keys';

export function useServerSettings() {
  return useQuery({
    queryKey: queryKeys.settings.current(),
    queryFn: ({ signal }) => fetchServerSettings(signal),
    staleTime: 30_000,
  });
}

export function useSaveServerSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: persistServerSettings,
    onSuccess: (_data, patch) => {
      queryClient.setQueryData<ServerSettings>(queryKeys.settings.current(), (current) => ({
        ...(current ?? {}),
        ...patch,
      }));
    },
  });
}
