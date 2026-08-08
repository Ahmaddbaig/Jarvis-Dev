'use client';

import { useQuery } from '@tanstack/react-query';
import { loadDynamicFunctions } from '@/frontend/lib/dynamic-functions';
import { queryKeys } from '@/frontend/lib/query/keys';

export function useDynamicFunctions() {
  return useQuery({
    queryKey: queryKeys.integrations.dynamicTools(),
    queryFn: ({ signal }) => loadDynamicFunctions(signal),
    staleTime: 30_000,
  });
}
