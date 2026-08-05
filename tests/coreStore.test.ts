import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoreStore } from '../backend/persistence/core-store';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-core-store-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Core settings store', () => {
  it('imports non-secret settings while keeping raw secrets out of SQLite', () => {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, 'jarvis-server-settings.json'), JSON.stringify({
      jarvis_ha_url: 'http://homeassistant.local:8123',
      jarvis_ha_token: 'ha-super-secret',
      jarvis_settings: JSON.stringify({
        schemaVersion: 1,
        apiMode: 'openai',
        apiKey: 'openai-super-secret',
        claudeApiKey: 'claude-super-secret',
        theme: 'midnight',
      }),
    }), { mode: 0o600 });

    const store = new CoreStore(directory, 'test');
    const stored = store.database.settings.getAll('server');
    expect(stored.jarvis_ha_url).toBe('http://homeassistant.local:8123');
    expect(JSON.stringify(stored)).not.toContain('super-secret');
    const visible = store.readServerSettings();
    expect(visible.jarvis_ha_token).toBeUndefined();
    expect(JSON.parse(visible.jarvis_settings)).toMatchObject({
      theme: 'midnight',
    });
    expect(visible.jarvis_settings).not.toContain('super-secret');
    expect(store.diagnostics().migrationSources).toMatchObject([{ state: 'imported' }]);
    store.close();
  });

  it('single-writes non-secret changes to SQLite and survives restart', () => {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, 'jarvis-server-settings.json'), JSON.stringify({
      jarvis_weather_location: 'Old location',
    }), { mode: 0o600 });
    const first = new CoreStore(directory, 'test');
    first.writeServerSettings({ jarvis_weather_location: 'New location' });
    expect(readFileSync(first.legacySettingsPath, 'utf8')).toContain('Old location');
    expect(first.readServerSettings().jarvis_weather_location).toBe('New location');
    first.close();

    const restarted = new CoreStore(directory, 'test');
    expect(restarted.readServerSettings().jarvis_weather_location).toBe('New location');
    restarted.close();
  });

  it('rejects credentials at the non-secret settings boundary', () => {
    const directory = temporaryDirectory();
    const store = new CoreStore(directory, 'test');
    expect(() => store.writeServerSettings({
      jarvis_settings: JSON.stringify({
        schemaVersion: 1,
        apiMode: 'openai',
        apiKey: 'new-secret',
        theme: 'crimson',
      }),
    })).toThrow(/credential service/);
    store.writeServerSettings({ jarvis_settings: JSON.stringify({ theme: 'crimson' }) });
    expect(JSON.parse(store.readServerSettings().jarvis_settings)).toEqual({ theme: 'crimson' });
    store.close();

    const restarted = new CoreStore(directory, 'test');
    expect(JSON.parse(restarted.readServerSettings().jarvis_settings)).toEqual({ theme: 'crimson' });
    expect(restarted.diagnostics().migrationSources).toMatchObject([{ state: 'missing' }]);
    restarted.close();
  });

  it('reports malformed legacy settings as quarantined', () => {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, 'jarvis-server-settings.json'), '{broken', { mode: 0o600 });
    const store = new CoreStore(directory, 'test');
    expect(store.readServerSettings()).toEqual({});
    expect(store.diagnostics().migrationSources).toMatchObject([{ state: 'quarantined' }]);
    store.close();
  });
});
