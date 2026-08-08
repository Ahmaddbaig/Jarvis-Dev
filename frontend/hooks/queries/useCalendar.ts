'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ICalEvent } from '@/app/api/ical/route';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface CalendarIntegrationStatus {
  configured?: boolean;
  connected?: boolean;
  tools?: number;
}

export function useCalendarIntegrationStatus() {
  return useQuery({
    queryKey: queryKeys.calendar.integrationStatus(),
    queryFn: ({ signal }) => fetchJson<CalendarIntegrationStatus>('/api/mcp/dynamic', {}, signal),
    staleTime: 15_000,
  });
}

export function useCalendarEvents(timeMin: string, timeMax: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.calendar.events(timeMin, timeMax),
    queryFn: async ({ signal }) => {
      const response = await fetchJson<{ events?: ICalEvent[]; error?: string }>(
        `/api/mcp/calendar-events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        {},
        signal,
      );
      if (response.error) throw new Error(response.error);
      return response.events ?? [];
    },
    enabled,
    staleTime: 30_000,
  });
}

export interface CreateCalendarEventInput {
  summary: string;
  date: string;
  time?: string;
}

export function useCreateCalendarEvent(timeMin: string, timeMax: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCalendarEventInput) => {
      const response = await fetchJson<{
        success?: boolean;
        error?: string;
        optimistic?: ICalEvent;
      }>('/api/mcp/create-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.success) throw new Error(response.error || 'Could not create Google Calendar event.');
      return response;
    },
    onSuccess: (response) => {
      if (response.optimistic) {
        queryClient.setQueryData<ICalEvent[]>(
          queryKeys.calendar.events(timeMin, timeMax),
          (current) => [...(current ?? []), response.optimistic!],
        );
      }
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.events(timeMin, timeMax) });
      }, 4_000);
    },
  });
}
