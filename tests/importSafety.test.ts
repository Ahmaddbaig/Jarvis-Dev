import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDataDirectory = process.env.JARVIS_DATA_DIR;
const directories: string[] = [];

afterEach(() => {
  const runtime = globalThis as typeof globalThis & { _bambuInitialized?: boolean };
  delete runtime._bambuInitialized;
  globalThis.__jarvisCoreStore = undefined;
  globalThis.__jarvisCredentialService = undefined;
  if (originalDataDirectory === undefined) delete process.env.JARVIS_DATA_DIR;
  else process.env.JARVIS_DATA_DIR = originalDataDirectory;
  vi.resetModules();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('server module import safety', () => {
  it('does not open persistence or migrate secrets when Bambu routes are evaluated at build time', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-import-safety-'));
    directories.push(directory);
    process.env.JARVIS_DATA_DIR = directory;
    await import('../backend/bambu/mqtt-manager');
    expect(existsSync(path.join(directory, 'jarvis-core.sqlite3'))).toBe(false);
    expect(existsSync(path.join(directory, 'migration-backups'))).toBe(false);
    expect(existsSync(path.join(directory, 'migration-quarantine'))).toBe(false);
  });
});
