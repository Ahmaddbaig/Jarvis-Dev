import { createRequire } from 'node:module';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JARVIS_REMOTE_PROTOCOL_VERSION, REMOTE_CAPABILITIES } from '../packages/contracts/src';

const require = createRequire(import.meta.url);
const { startCompanion } = require('../apps/companion/server.cjs') as {
  startCompanion: (options: Record<string, unknown>) => Promise<{
    server: { address(): { port: number } | string | null };
    getInfo(): { pairingCode: string };
    stop(): Promise<void>;
  }>;
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function request(port: number, method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? '' : JSON.stringify(body);
    const req = https.request({
      host: '127.0.0.1', port, method, path: pathname, rejectUnauthorized: false,
      headers: encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : undefined,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      }));
    });
    req.on('error', reject);
    req.end(encoded);
  });
}

describe('packaged Companion server contract', () => {
  it('boots its native dependencies and enforces protocol negotiation before pairing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-companion-test-'));
    temporaryDirectories.push(dataDir);
    const companion = await startCompanion({ host: '127.0.0.1', port: 0, dataDir, deviceName: 'Synthetic Companion' });
    const address = companion.server.address();
    if (!address || typeof address === 'string') throw new Error('Companion did not bind a TCP port.');
    try {
      const identity = await request(address.port, 'GET', '/v1/identity');
      expect(identity.status).toBe(200);
      expect(identity.body).toMatchObject({
        protocol: JARVIS_REMOTE_PROTOCOL_VERSION,
        componentVersion: '1.0.0',
        capabilities: [...REMOTE_CAPABILITIES.companion],
        deviceName: 'Synthetic Companion',
      });

      const incompatible = await request(address.port, 'POST', '/v1/pair', {
        code: companion.getInfo().pairingCode,
        protocol: 1,
        controllerVersion: 'synthetic',
        capabilities: [],
      });
      expect(incompatible.status).toBe(409);
      expect(incompatible.body.error).toContain('incompatible');
    } finally {
      await companion.stop();
    }
  }, 30_000);
});
