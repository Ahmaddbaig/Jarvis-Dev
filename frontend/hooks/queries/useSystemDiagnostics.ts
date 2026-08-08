'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export function useSystemDiagnostics() {
  return useQuery({
    queryKey: queryKeys.diagnostics.system(),
    queryFn: ({ signal }) => fetchJson<unknown>('/api/system-diagnostics', {}, signal),
    enabled: false,
    retry: false,
    staleTime: 0,
  });
}
