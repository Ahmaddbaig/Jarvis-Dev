import { QueryClient } from '@tanstack/react-query';
import { JarvisApiError } from './fetchJson';

export const queryTimings = {
  defaultStaleTimeMs: 30_000,
  defaultGcTimeMs: 5 * 60_000,
  fastPollMs: 4_000,
  standardPollMs: 30_000,
  slowPollMs: 5 * 60_000,
} as const;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof JarvisApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export function createJarvisQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: queryTimings.defaultStaleTimeMs,
        gcTime: queryTimings.defaultGcTimeMs,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
