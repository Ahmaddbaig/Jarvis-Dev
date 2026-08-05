import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoreStore } from '../backend/persistence/core-store';
import { CredentialService } from '../backend/secrets/credential-service';
import {
  credentialPatchFromLegacySettings,
  migrateLegacyCredentials,
} from '../backend/secrets/legacy-credentials';
import { MemorySecretVault } from '../packages/secrets/src';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-legacy-credentials-'));
  directories.push(directory);
  return directory;
}

describe('legacy credential migration', () => {
  it('extracts recognized credentials without copying unrelated settings', () => {
    expect(credentialPatchFromLegacySettings({
      jarvis_ha_token: 'ha-token',
      jarvis_ical_url: 'https://calendar.example/private.ics',
      jarvis_settings: JSON.stringify({ apiKey: 'openai-key', claudeApiKey: 'claude-key', theme: 'matrix' }),
    })).toEqual({
      openaiApiKey: 'openai-key',
      anthropicApiKey: 'claude-key',
      homeAssistantToken: 'ha-token',
      icalFeedUrl: 'https://calendar.example/private.ics',
    });
  });

  it('backs up, verifies, and removes migrated plaintext credentials', () => {
    const directory = temporaryDirectory();
    const legacyPath = path.join(directory, 'jarvis-server-settings.json');
    writeFileSync(legacyPath, JSON.stringify({
      jarvis_ha_url: 'http://homeassistant.local:8123',
      jarvis_ha_token: 'ha-token',
      jarvis_settings: JSON.stringify({ apiKey: 'openai-key', theme: 'matrix' }),
    }), { mode: 0o600 });
    const store = new CoreStore(directory, 'test');
    const service = new CredentialService(store.database, new MemorySecretVault());
    migrateLegacyCredentials(store, service);

    expect(service.get('openaiApiKey')).toBe('openai-key');
    expect(service.get('homeAssistantToken')).toBe('ha-token');
    const sanitized = readFileSync(legacyPath, 'utf8');
    expect(sanitized).not.toContain('openai-key');
    expect(sanitized).not.toContain('ha-token');
    expect(sanitized).toContain('homeassistant.local');
    expect(store.database.secretRefs.list()).toHaveLength(2);
    expect(store.diagnostics().migrationSources.some((source) =>
      source.sourceId === 'jarvis-legacy-secrets-v1' && source.state === 'imported'
    )).toBe(true);
    store.close();
  });
});
