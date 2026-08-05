'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface StorageDiagnostics {
  path: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  integrity: string;
  journalMode: string;
  migrations: Array<{ id: number; name: string; appliedAt: string; appVersion: string }>;
  migrationSources: Array<{ sourceId: string; state: string; processedAt: string; detail?: string }>;
}

export interface RecoveryExportResult {
  ok: true;
  pages: number;
  files: { database: string; json: string };
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `Storage request returned HTTP ${response.status}.`;
}

export function useStorageDiagnostics() {
  return useQuery({
    queryKey: queryKeys.diagnostics.storage(),
    queryFn: async ({ signal }) => {
      const response = await desktopControlFetch('/api/storage', { cache: 'no-store', signal });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<StorageDiagnostics>;
    },
    enabled: false,
    retry: false,
    staleTime: 0,
  });
}

export function useCreateRecoveryExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await desktopControlFetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recovery-export' }),
      });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<RecoveryExportResult>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.diagnostics.storage() }),
  });
}
