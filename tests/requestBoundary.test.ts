import { describe, expect, it } from 'vitest';
import { evaluateRequestBoundary } from '../backend/gateway/request-boundary';

const TOKEN = 'a'.repeat(43);

function request(method: string, url: string, headers: Record<string, string> = {}) {
  return { method, url, headers: new Headers(headers) };
}

describe('internal API request boundary', () => {
  it('accepts same-origin loopback requests and rejects cross-origin mutations', () => {
    expect(evaluateRequestBoundary(request('POST', 'http://127.0.0.1:3100/api/settings', {
      Origin: 'http://127.0.0.1:3100',
    }), TOKEN).kind).toBe('loopback');
    expect(evaluateRequestBoundary(request('POST', 'http://127.0.0.1:3100/api/settings', {
      Origin: 'https://attacker.example',
    }), TOKEN)).toMatchObject({ allowed: false, reason: 'CROSS_ORIGIN_REJECTED' });
    expect(evaluateRequestBoundary(request('POST', 'http://127.0.0.1:3100/api/settings'), TOKEN))
      .toMatchObject({ allowed: false, reason: 'MUTATION_ORIGIN_REQUIRED' });
  });

  it('uses the validated Host header when Next normalizes its internal request URL', () => {
    expect(evaluateRequestBoundary(request('POST', 'http://localhost:3199/api/settings', {
      Host: '127.0.0.1:3199',
      Origin: 'http://127.0.0.1:3199',
    }), TOKEN)).toMatchObject({ allowed: true, kind: 'loopback' });
    expect(evaluateRequestBoundary(request('POST', 'http://localhost:3199/api/settings', {
      Host: 'attacker.example',
      Origin: 'http://attacker.example',
    }), TOKEN)).toMatchObject({ allowed: false, reason: 'LOOPBACK_REQUIRED' });
  });

  it('rejects Fetch Metadata that identifies a cross-site read even without an Origin', () => {
    expect(evaluateRequestBoundary(request('GET', 'http://127.0.0.1:3100/api/settings', {
      'Sec-Fetch-Site': 'cross-site',
    }), TOKEN)).toMatchObject({ allowed: false, reason: 'CROSS_SITE_REJECTED' });
  });

  it('accepts the desktop bearer trust channel without a browser origin', () => {
    expect(evaluateRequestBoundary(request('POST', 'http://127.0.0.1:3100/api/lan-gateway/session', {
      Authorization: `Bearer ${TOKEN}`,
    }), TOKEN)).toMatchObject({ allowed: true, kind: 'desktop' });
  });

  it('requires CSRF verification on trusted gateway mutations', () => {
    const headers = {
      'X-Jarvis-Gateway-Auth': TOKEN,
      'X-Jarvis-Lan-Actor': 'lan-client:synthetic-device',
    };
    expect(evaluateRequestBoundary(request('PUT', 'http://127.0.0.1:3100/api/tasks', headers), TOKEN))
      .toMatchObject({ allowed: false, reason: 'LAN_CSRF_UNVERIFIED' });
    expect(evaluateRequestBoundary(request('PUT', 'http://127.0.0.1:3100/api/tasks', {
      ...headers,
      'X-Jarvis-CSRF-Verified': '1',
    }), TOKEN)).toMatchObject({ allowed: true, kind: 'gateway' });
  });

  it('permits only Chrome extension origins on extension protocol paths', () => {
    expect(evaluateRequestBoundary(request('POST', 'http://127.0.0.1:3100/api/chrome-control/extension', {
      Origin: `chrome-extension://${'a'.repeat(32)}`,
    }), TOKEN).kind).toBe('extension');
    expect(evaluateRequestBoundary(request('POST', 'http://127.0.0.1:3100/api/tasks', {
      Origin: `chrome-extension://${'a'.repeat(32)}`,
    }), TOKEN).allowed).toBe(false);
  });
});
