import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, JarvisApiError } from '../frontend/lib/query/fetchJson';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('query JSON transport', () => {
  it('parses successful JSON and forwards the query cancellation signal', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJson<{ ok: boolean }>('/api/test', {}, controller.signal)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('normalizes nested API failures into a typed status/code error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Approval required.', code: 'APPROVAL_REQUIRED', details: { capability: 'shell' } },
    }), { status: 403 })));

    const error = await fetchJson('/api/test').catch((caught) => caught);
    expect(error).toBeInstanceOf(JarvisApiError);
    expect(error).toMatchObject({
      message: 'Approval required.',
      status: 403,
      code: 'APPROVAL_REQUIRED',
      details: { capability: 'shell' },
    });
  });

  it('supports empty success responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(fetchJson('/api/test')).resolves.toBeUndefined();
  });
});
