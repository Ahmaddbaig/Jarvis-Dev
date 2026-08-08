'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface NewsHeadline {
  title: string;
  link: string;
}

interface NewsResponse {
  items?: NewsHeadline[];
}

export function useNewsHeadlines() {
  return useQuery({
    queryKey: queryKeys.news.headlines(),
    queryFn: ({ signal }) => fetchJson<NewsResponse>('/api/news-headlines', {}, signal),
    select: (response) => response.items ?? [],
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
