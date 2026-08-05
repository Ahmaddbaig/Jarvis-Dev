import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreStore } from '../backend/persistence/core-store';
import { CredentialService } from '../backend/secrets/credential-service';
import { MemorySecretVault } from '../packages/secrets/src';

const originalDataDirectory = process.env.JARVIS_DATA_DIR;

function installTestServices(directory: string) {
  process.env.JARVIS_DATA_DIR = directory;
  const store = new CoreStore(directory, 'test');
  const credentials = new CredentialService(store.database, new MemorySecretVault());
  globalThis.__jarvisCoreStore = store;
  globalThis.__jarvisCredentialService = credentials;
  return { store, credentials };
}

afterEach(() => {
  const runtime = globalThis as typeof globalThis & {
    _bambuInitialized?: boolean;
    _bambuToken?: unknown;
    __jarvisChromeRuntime?: unknown;
  };
  delete runtime._bambuInitialized;
  delete runtime._bambuToken;
  delete runtime.__jarvisChromeRuntime;
  globalThis.__jarvisCredentialService = undefined;
  globalThis.__jarvisCoreStore = undefined;
  if (originalDataDirectory === undefined) delete process.env.JARVIS_DATA_DIR;
  else process.env.JARVIS_DATA_DIR = originalDataDirectory;
  vi.resetModules();
});

describe.sequential('integration secret migrations', () => {
  it('backs up and moves a Bambu token into the vault, then removes plaintext', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-bambu-migration-'));
    const tokenPath = path.join(directory, '.bambu-token.json');
    writeFileSync(tokenPath, JSON.stringify({
      accessToken: 'synthetic-bambu-access',
      refreshToken: 'synthetic-bambu-refresh',
      tokenExpiration: Date.now() - 1,
    }), { mode: 0o600 });
    const { store, credentials } = installTestServices(directory);

    const bambu = await import('../backend/bambu/mqtt-manager');
    bambu.getToken();
    expect(credentials.getSecret(bambu.BAMBU_TOKEN_SECRET)).toContain('synthetic-bambu-access');
    expect(() => statSync(tokenPath)).toThrow();
    expect(store.diagnostics().migrationSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'bambu-token-v1', state: 'imported' }),
    ]));
    store.close();
  });

  it('moves companion bearer tokens to the vault and pairing metadata to SQLite', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-companion-migration-'));
    const registryPath = path.join(directory, 'jarvis-companions.json');
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      devices: [{
        id: 'synthetic-device',
        name: 'Synthetic PC',
        address: 'https://192.168.1.40:45831',
        token: 'synthetic-companion-bearer',
        fingerprint: 'a'.repeat(64),
        platform: 'win32',
        arch: 'x64',
        pairedAt: '2026-01-01T00:00:00.000Z',
      }],
    }), { mode: 0o600 });
    const { store, credentials } = installTestServices(directory);

    const registry = await import('../backend/companion/registry');
    const loaded = registry.readCompanionRegistry();
    expect(loaded.devices[0]?.token).toBe('synthetic-companion-bearer');
    expect(credentials.getSecret(registry.companionTokenSecret('synthetic-device'))).toBe('synthetic-companion-bearer');
    expect(store.database.devices.get('synthetic-device')).toMatchObject({ kind: 'companion' });
    expect(store.database.pairings.get('companion:synthetic-device')).toMatchObject({ state: 'paired' });
    expect(readFileSync(registryPath, 'utf8')).not.toContain('synthetic-companion-bearer');
    store.close();
  });

  it('moves the Chrome token hash and extension metadata into SQLite', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-chrome-migration-'));
    const pairingPath = path.join(directory, 'jarvis-chrome-control.json');
    const tokenHash = createHash('sha256').update('synthetic-extension-token').digest('hex');
    writeFileSync(pairingPath, JSON.stringify({
      tokenHash,
      extensionId: 'a'.repeat(32),
      extensionName: 'Synthetic Chrome',
      pairedAt: '2026-01-01T00:00:00.000Z',
    }), { mode: 0o600 });
    const { store } = installTestServices(directory);

    const chrome = await import('../backend/chrome/control');
    expect(chrome.chromeControlStatus()).toMatchObject({ paired: true, extensionName: 'Synthetic Chrome' });
    expect(store.database.pairings.get('chrome-extension')?.metadata).toMatchObject({ tokenHash });
    expect(() => statSync(pairingPath)).toThrow();
    store.close();
  });

  it('moves Google client secrets to the vault and hardens provider token files', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'jarvis-google-migration-'));
    const credentialsPath = path.join(directory, 'google', 'credentials.json');
    mkdirSync(path.dirname(credentialsPath), { recursive: true });
    writeFileSync(credentialsPath, JSON.stringify({
      installed: {
        client_id: 'synthetic-client.apps.googleusercontent.com',
        client_secret: 'synthetic-google-client-secret',
        project_id: 'synthetic-project',
      },
    }), { mode: 0o600 });
    const { store, credentials } = installTestServices(directory);

    const google = await import('../backend/secrets/google-credentials');
    expect(google.googleOAuthClientInfo()).toMatchObject({ projectId: 'synthetic-project' });
    expect(credentials.getSecret(google.GOOGLE_OAUTH_CLIENT_SECRET)).toContain('synthetic-google-client-secret');
    expect(() => statSync(credentialsPath)).toThrow();

    const materialized = google.materializeGoogleOAuthCredentials();
    expect(statSync(materialized).mode & 0o777).toBe(0o600);
    google.removeMaterializedGoogleOAuthCredentials();

    const tokenPath = path.join(directory, 'google-calendar-mcp', 'tokens.json');
    mkdirSync(path.dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, JSON.stringify({ refresh_token: 'synthetic-refresh-token' }), { mode: 0o644 });
    expect(google.googleServiceAuthenticated('calendar')).toBe(true);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    expect(store.database.secretRefs.get('credential.google.calendar.provider-token')).toMatchObject({
      vaultService: 'provider-protected-file',
      vaultAccount: 'google.calendar.provider-token',
    });
    expect(JSON.stringify(store.database.secretRefs.list())).not.toContain('synthetic-refresh-token');
    store.close();
  });
});
