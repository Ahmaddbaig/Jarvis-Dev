'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface StockQuote {
  symbol: string;
  price?: number;
  change?: number;
  changePct?: number;
  up?: boolean;
  sparkline?: number[];
  error?: string;
}

interface StockQuotesResponse {
  quotes?: StockQuote[];
}

function normalizeSymbols(symbols: string | readonly string[]): string[] {
  const values = typeof symbols === 'string' ? symbols.split(',') : symbols;
  return values.map((symbol) => symbol.trim()).filter(Boolean).slice(0, 14);
}

export function useStockQuotes(symbols: string | readonly string[], refetchInterval = 30_000) {
  const normalizedSymbols = normalizeSymbols(symbols);
  return useQuery({
    queryKey: queryKeys.stocks.quotes(normalizedSymbols),
    queryFn: ({ signal }) => fetchJson<StockQuotesResponse>(
      `/api/stock-quote?symbols=${encodeURIComponent(normalizedSymbols.join(','))}`,
      {},
      signal,
    ),
    select: (response) => response.quotes ?? [],
    enabled: normalizedSymbols.length > 0,
    staleTime: refetchInterval,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}
