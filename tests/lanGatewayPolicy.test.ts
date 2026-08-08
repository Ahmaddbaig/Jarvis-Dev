import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lanScopeSchema } from '@jarvis/contracts';
import {
  isLanPageOrAsset,
  lanApiAllowlistEntries,
  lanRouteDecision,
  LAN_GATEWAY_SCOPES,
  LAN_SESSION_COOKIE,
  normalizeLanPath,
  stripUntrustedGatewayHeaders,
  UNTRUSTED_INBOUND_HEADERS,
} from '../apps/desktop/src/lan-gateway-policy';

describe('LAN gateway allowlist', () => {
  it('allows only explicit method and route pairs with a scope', () => {
    expect(lanRouteDecision('/api/tasks', 'GET')).toMatchObject({
      allowed: true,
      requiredScope: 'read',
      consequential: false,
    });
    expect(lanRouteDecision('/api/tasks', 'PUT')).toMatchObject({
      allowed: true,
      requiredScope: 'control',
      consequential: true,
    });
    expect(lanRouteDecision('/api/tasks', 'DELETE').allowed).toBe(false);
    expect(lanApiAllowlistEntries().length).toBeGreaterThan(30);
  });

  it.each([
    ['/api/shell', 'POST'],
    ['/api/skills/execute', 'POST'],
    ['/api/mcp/dynamic', 'POST'],
    ['/api/mcp', 'POST'],
    ['/api/credentials', 'GET'],
    ['/api/storage', 'GET'],
    ['/api/companions', 'GET'],
    ['/api/computer-use', 'POST'],
    ['/api/chrome-control', 'GET'],
    ['/api/open-url', 'POST'],
    ['/api/system-diagnostics', 'GET'],
  ])('never exposes %s %s through the LAN gateway', (pathname, method) => {
    expect(lanRouteDecision(pathname, method).allowed).toBe(false);
  });

  it('allows application pages and assets but never treats API paths as pages', () => {
    expect(isLanPageOrAsset('/')).toBe(true);
    expect(isLanPageOrAsset('/_next/static/chunk.js')).toBe(true);
    expect(isLanPageOrAsset('/api/tasks')).toBe(false);
  });

  it('keeps the gateway scope union aligned with the shared contract', () => {
    // The gateway is the component that decides authorization and the one
    // component that cannot import @jarvis/contracts, so nothing but this
    // assertion catches a renamed or added scope.
    expect([...LAN_GATEWAY_SCOPES].sort()).toEqual([...lanScopeSchema.options].sort());
  });

  it('refuses paths whose encoding hides the route from the API allowlist', () => {
    // /api%2Fsettings parses as one opaque segment, so it is neither matched
    // by the allowlist nor by the Next proxy matcher: both guards fail open.
    expect(normalizeLanPath('/api%2Fsettings')).toBeNull();
    expect(normalizeLanPath('/api%2fshell')).toBeNull();
    expect(normalizeLanPath('/api%5cshell')).toBeNull();
    expect(normalizeLanPath('/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(normalizeLanPath('/api/../api/shell')).toBeNull();
    expect(normalizeLanPath('/api/%ZZ')).toBeNull();
  });

  it('resolves ordinary paths to the form every downstream guard sees', () => {
    expect(normalizeLanPath('/api/tasks')).toBe('/api/tasks');
    expect(normalizeLanPath('/')).toBe('/');
    expect(normalizeLanPath('/_next/static/a%20b.js')).toBe('/_next/static/a b.js');
  });

  it('never lets a LAN client supply its own trust headers', () => {
    const headers: Record<string, unknown> = {
      'authorization': 'Bearer forged-desktop-token',
      'x-jarvis-gateway-auth': 'forged-desktop-token',
      'x-jarvis-lan-actor': 'desktop-local',
      'x-jarvis-lan-scopes': 'read,control,ai,settings',
      'x-jarvis-csrf-verified': '1',
      'x-jarvis-gateway-verified': '1',
      'content-type': 'application/json',
    };
    stripUntrustedGatewayHeaders(headers);
    for (const name of UNTRUSTED_INBOUND_HEADERS) expect(headers[name]).toBeUndefined();
    // Non-trust headers must survive, or ordinary proxying breaks.
    expect(headers['content-type']).toBe('application/json');
  });

  it('drops the gateway session cookie while retaining unrelated cookies', () => {
    const headers: Record<string, unknown> = {
      cookie: `theme=dark; ${LAN_SESSION_COOKIE}=forged-session-value; locale=en`,
    };
    stripUntrustedGatewayHeaders(headers);
    expect(headers.cookie).toBe('theme=dark; locale=en');
    expect(String(headers.cookie)).not.toContain(LAN_SESSION_COOKIE);

    const onlySession: Record<string, unknown> = { cookie: `${LAN_SESSION_COOKIE}=abc` };
    stripUntrustedGatewayHeaders(onlySession);
    expect(onlySession.cookie).toBeUndefined();
  });

  it('keeps the audited route inventory exactly aligned with the executable allowlist', () => {
    const inventory = JSON.parse(readFileSync(
      path.join(process.cwd(), 'docs/refactor/route-inventory.json'),
      'utf8',
    )) as { routes: Array<{ route: string; lanMethods?: string[]; auth: string }> };
    const inventoried = inventory.routes.flatMap((route) => (route.lanMethods ?? [])
      .map((method) => `${method} ${route.route}`)).sort();
    expect(inventoried).toEqual(lanApiAllowlistEntries());
    expect(inventory.routes.filter((route) => route.lanMethods?.length)
      .every((route) => route.auth === 'lan-paired-cookie')).toBe(true);
  });
});
