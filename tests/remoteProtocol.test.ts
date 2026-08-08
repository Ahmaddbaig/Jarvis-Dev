import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JARVIS_REMOTE_PROTOCOL_VERSION,
  REMOTE_CAPABILITIES,
  createIdempotencyKey,
  remoteCommandSchema,
  remoteHandshakeSchema,
} from '../packages/contracts/src';
import { createChromeCommand } from '../backend/chrome/control';

const require = createRequire(import.meta.url);
const { ResultLedger } = require('../apps/companion/result-ledger.cjs') as {
  ResultLedger: new (options?: Record<string, unknown>) => {
    prepare(input: Record<string, unknown>): Record<string, unknown>;
    record(context: Record<string, unknown>, status: number, body: unknown, persistent?: boolean): void;
    acknowledge(controllerId: string, keys: string[]): number;
  };
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('shared Chrome and Companion protocol', () => {
  it('keeps every packaged protocol descriptor byte-for-byte compatible', () => {
    const canonical = JSON.parse(fs.readFileSync('packages/contracts/remote-protocol.json', 'utf8'));
    const chrome = JSON.parse(fs.readFileSync('chrome-extension/remote-protocol.json', 'utf8'));
    const companion = JSON.parse(fs.readFileSync('apps/companion/remote-protocol.json', 'utf8'));
    expect(chrome).toEqual(canonical);
    expect(companion).toEqual(canonical);
    expect(canonical.protocol).toBe(JARVIS_REMOTE_PROTOCOL_VERSION);
    expect(canonical.chromeCapabilities).toEqual(REMOTE_CAPABILITIES.chrome);
    expect(canonical.companionCapabilities).toEqual(REMOTE_CAPABILITIES.companion);
  });

  it('validates peer build identity and Chrome commands with the same contract', () => {
    expect(remoteHandshakeSchema.safeParse({
      protocol: JARVIS_REMOTE_PROTOCOL_VERSION,
      component: 'companion',
      componentVersion: '1.0.0',
      buildId: 'synthetic-build',
      capabilities: [...REMOTE_CAPABILITIES.companion],
    }).success).toBe(true);

    const command = createChromeCommand('type', { selector: '#synthetic', text: 'fixture value' });
    expect(remoteCommandSchema.parse(command)).toEqual(command);
    expect(command.idempotencyKey).toContain(command.commandId);
    expect(command.targetFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('Companion result ledger', () => {
  it('replays exactly once, rejects key reuse, survives restart, and removes acknowledged results', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ledger-test-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'command-results.json');
    const now = Date.parse('2030-01-01T00:00:00.000Z');
    const options = { filePath, now: () => now, retentionMs: 300_000 };
    const request = {
      controllerId: 'synthetic-controller',
      idempotencyKey: createIdempotencyKey(),
      deadline: new Date(now + 30_000).toISOString(),
      method: 'POST',
      pathname: '/v1/input',
      body: { actions: [{ type: 'click', x: 10, y: 20 }] },
    };
    const ledger = new ResultLedger(options);
    const first = ledger.prepare(request);
    expect(first.kind).toBe('new');
    ledger.record(first, 200, { success: true, actionsExecuted: 1 }, true);

    expect(ledger.prepare(request)).toMatchObject({
      kind: 'replay',
      status: 200,
      body: { success: true, actionsExecuted: 1 },
    });
    expect(ledger.prepare({ ...request, body: { actions: [{ type: 'click', x: 99, y: 20 }] } }))
      .toMatchObject({ kind: 'error', status: 409 });

    const restarted = new ResultLedger(options);
    expect(restarted.prepare(request)).toMatchObject({ kind: 'replay', status: 200 });
    expect(restarted.acknowledge(request.controllerId, [request.idempotencyKey])).toBe(1);
    expect(restarted.prepare(request)).toMatchObject({ kind: 'new' });
  });
});
