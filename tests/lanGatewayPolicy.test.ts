import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isLanPageOrAsset,
  lanApiAllowlistEntries,
  lanRouteDecision,
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
