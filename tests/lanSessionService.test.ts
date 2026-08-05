import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LanGatewayAuthError, LanSessionService } from '../backend/gateway/lan-session-service';
import { CoreStore } from '../backend/persistence/core-store';

const directories: string[] = [];

function service() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-lan-session-'));
  directories.push(directory);
  const store = new CoreStore(directory, 'test');
  return { store, service: new LanSessionService(store) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('paired LAN sessions', () => {
  it('exchanges a one-time code for a scoped token hash and supports immediate revocation', () => {
    const fixture = service();
    const pairing = fixture.service.createPairing(['read', 'control']);
    const exchanged = fixture.service.exchange({
      code: pairing.code,
      clientName: 'Synthetic tablet',
      remoteAddress: '192.168.1.50',
      userAgent: 'synthetic-agent',
    });
    expect(exchanged.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fixture.service.currentPairing()).toBeNull();
    expect(JSON.stringify(fixture.store.database.pairings.list())).not.toContain(exchanged.token);
    expect(fixture.service.authorize({
      token: exchanged.token,
      method: 'GET',
      path: '/api/tasks',
      requiredScope: 'read',
      consequential: false,
      remoteAddress: '192.168.1.50',
    })).toMatchObject({ name: 'Synthetic tablet', scopes: ['read', 'control'] });
    expect(() => fixture.service.authorize({
      token: exchanged.token,
      method: 'POST',
      path: '/api/voice/chat',
      requiredScope: 'ai',
      consequential: true,
      remoteAddress: '192.168.1.50',
    })).toThrow(LanGatewayAuthError);
    expect(fixture.service.revoke(exchanged.client.id)).toBe(true);
    expect(() => fixture.service.authorize({
      token: exchanged.token,
      method: 'GET',
      path: '/',
      requiredScope: null,
      consequential: false,
      remoteAddress: '192.168.1.50',
    })).toThrow(/not paired/);
    expect(fixture.store.database.securityAudit.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: 'allowed', reason: 'PAIRING_SUCCEEDED' }),
      expect.objectContaining({ decision: 'revoked', reason: 'CLIENT_REVOKED' }),
      expect.objectContaining({ decision: 'denied', reason: 'SCOPE_DENIED' }),
    ]));
    fixture.store.close();
  });

  it('rate limits repeated incorrect pairing attempts without persisting the code', () => {
    const fixture = service();
    fixture.service.createPairing(['read']);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => fixture.service.exchange({
        code: '999999',
        clientName: 'Attacker',
        remoteAddress: '192.168.1.99',
        userAgent: '',
      })).toThrow(/incorrect/);
    }
    expect(() => fixture.service.exchange({
      code: '999999',
      clientName: 'Attacker',
      remoteAddress: '192.168.1.99',
      userAgent: '',
    })).toThrow(/Too many pairing attempts/);
    expect(JSON.stringify(fixture.store.database.securityAudit.list())).not.toMatch(/999999/);
    fixture.store.close();
  });
});
