import { describe, expect, it } from 'vitest';
import { createJarvisQueryClient, queryTimings, shouldRetryQuery } from '../frontend/lib/query/client';
import { JarvisApiError } from '../frontend/lib/query/fetchJson';
import { queryKeys } from '../frontend/lib/query/keys';

describe('renderer query conventions', () => {
  it('uses deterministic centralized keys', () => {
    expect(queryKeys.stocks.quotes(['TSLA', 'AAPL'])).toEqual([
      'stocks',
      'quotes',
      ['AAPL', 'TSLA'],
    ]);
    expect(queryKeys.calendar.events('2026-08-01', '2026-08-31')).toEqual([
      'calendar',
      'events',
      { timeMin: '2026-08-01', timeMax: '2026-08-31' },
    ]);
  });

  it('retries only transient API failures and caps attempts', () => {
    expect(shouldRetryQuery(0, new JarvisApiError('bad request', 400))).toBe(false);
    expect(shouldRetryQuery(0, new JarvisApiError('busy', 429))).toBe(true);
    expect(shouldRetryQuery(1, new JarvisApiError('unavailable', 503))).toBe(true);
    expect(shouldRetryQuery(2, new JarvisApiError('unavailable', 503))).toBe(false);
    expect(shouldRetryQuery(0, new TypeError('network failed'))).toBe(true);
  });

  it('creates isolated clients with the documented cache timing', () => {
    const first = createJarvisQueryClient();
    const second = createJarvisQueryClient();
    expect(first).not.toBe(second);
    expect(first.getDefaultOptions().queries?.staleTime).toBe(queryTimings.defaultStaleTimeMs);
    expect(first.getDefaultOptions().queries?.gcTime).toBe(queryTimings.defaultGcTimeMs);
    expect(first.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
