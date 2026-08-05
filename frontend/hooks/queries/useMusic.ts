'use client';

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface TrackInfo {
  app: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  position: number;
  duration: number;
  isPlaying: boolean;
}

export function nowPlayingQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.music.nowPlaying(),
    queryFn: async ({ signal }) => {
      const response = await fetchJson<TrackInfo & { error?: string }>('/api/music', {}, signal);
      return response.error ? null : response;
    },
    staleTime: 5_000,
    refetchInterval: 6_000,
    refetchIntervalInBackground: false,
  });
}

export function useNowPlaying() {
  return useQuery(nowPlayingQueryOptions());
}

export function useMusicCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ command, value }: { command: string; value?: number }) => fetchJson<unknown>('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, value }),
    }),
    onMutate: ({ command }) => {
      if (!['playpause', 'play', 'pause'].includes(command)) return;
      queryClient.setQueryData<TrackInfo | null>(queryKeys.music.nowPlaying(), (current) => current
        ? {
            ...current,
            isPlaying: command === 'play' ? true : command === 'pause' ? false : !current.isPlaying,
          }
        : current
      );
    },
    onSettled: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.music.all });
      }, 600);
    },
  });
}
