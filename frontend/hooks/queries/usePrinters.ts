'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface PrinterInfo {
  deviceId: string;
  name: string;
  model?: string;
}

export interface PrinterTelemetry {
  gcode_state?: string;
  subtask_name?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  wifi_signal?: string;
  ams?: { ams?: Array<{ tray: Array<{ id: string; tray_color?: string; tray_id_name?: string; cols?: string[] }> }> };
  ams_status?: string;
  [key: string]: unknown;
}

export interface PrintTask {
  id: string | number;
  title?: string;
  deviceName?: string;
  cover?: string;
  status?: number;
  costTime?: number;
  weight?: number;
}

export interface PrinterStatus {
  authenticated?: boolean;
  mqttConnected?: boolean;
}

export function usePrinterStatus() {
  return useQuery({
    queryKey: queryKeys.printers.status(),
    queryFn: ({ signal }) => fetchJson<PrinterStatus>('/api/bambu/status', {}, signal),
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
  });
}

export function usePrinterDevices(enabled = true) {
  return useQuery({
    queryKey: queryKeys.printers.devices(),
    queryFn: ({ signal }) => fetchJson<PrinterInfo[]>('/api/bambu/printers', {}, signal),
    enabled,
    staleTime: 30_000,
  });
}

export function usePrinterTelemetry(enabled = true) {
  return useQuery({
    queryKey: queryKeys.printers.telemetry(),
    queryFn: ({ signal }) => fetchJson<Record<string, PrinterTelemetry>>('/api/bambu/telemetry', {}, signal),
    enabled,
    staleTime: 2_000,
    refetchInterval: enabled ? 3_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function usePrinterTasks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.printers.tasks(),
    queryFn: ({ signal }) => fetchJson<{ tasks?: PrintTask[] }>('/api/bambu/tasks', {}, signal),
    select: (response) => response.tasks ?? [],
    enabled,
    staleTime: 60_000,
  });
}

export function usePrinterCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, command }: { deviceId: string; command: string }) => fetchJson<unknown>('/api/bambu/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, command }),
    }),
    onSuccess: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.printers.telemetry() });
      }, 500);
    },
  });
}

export function useDisconnectPrinters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<unknown>('/api/bambu/status', { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.printers.all });
    },
  });
}
