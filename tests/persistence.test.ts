import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JarvisDatabase,
  LATEST_SCHEMA_VERSION,
  UnsupportedSchemaVersionError,
  migrateLegacyJson,
} from '../packages/persistence/src';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-persistence-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Jarvis SQLite persistence', () => {
  it('applies the versioned schema and persists settings across restart', () => {
    const filePath = path.join(temporaryDirectory(), 'jarvis.sqlite3');
    const first = new JarvisDatabase(filePath, '1.1.0-test');
    first.settings.setMany('server', { theme: 'matrix', enabled: true });
    expect(first.diagnostics()).toMatchObject({
      schemaVersion: LATEST_SCHEMA_VERSION,
      integrity: 'ok',
      migrations: [{ id: 1, name: 'initial-core-schema', appVersion: '1.1.0-test' }],
    });
    first.close();

    const restarted = new JarvisDatabase(filePath, '1.1.1-test');
    expect(restarted.settings.getAll('server')).toEqual({ enabled: true, theme: 'matrix' });
    restarted.close();
  });

  it('rolls back repository writes with the owning transaction', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    expect(() => database.transaction(() => {
      database.settings.set('server', 'theme', 'crimson');
      throw new Error('abort');
    })).toThrow('abort');
    expect(database.settings.getAll('server')).toEqual({});
    database.close();
  });

  it('round-trips and replaces local tasks transactionally', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    database.tasks.replaceAll([
      { id: 'one', date: '2026-08-05', text: 'First task', done: false, time: '3:00 PM' },
      { id: 'two', date: '2026-08-06', text: 'Second task', done: true },
    ]);
    expect(database.tasks.list()).toHaveLength(2);
    database.tasks.replaceAll([{ id: 'three', date: '2026-08-07', text: 'Replacement', done: false }]);
    expect(database.tasks.list()).toEqual([
      { id: 'three', date: '2026-08-07', text: 'Replacement', done: false },
    ]);
    database.close();
  });

  it('round-trips device and pairing metadata without embedding credentials', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    database.devices.put({
      id: 'device-1',
      kind: 'companion',
      friendlyName: 'Synthetic PC',
      platform: 'win32',
      metadata: { address: 'https://192.168.1.10:45831' },
    });
    database.pairings.put({
      id: 'companion:device-1',
      deviceId: 'device-1',
      certificateFingerprint: 'synthetic-fingerprint',
      state: 'paired',
      pairedAt: '2026-01-01T00:00:00.000Z',
      metadata: { protocol: 1 },
    });

    expect(database.devices.get('device-1')).toMatchObject({
      kind: 'companion',
      friendlyName: 'Synthetic PC',
      metadata: { address: 'https://192.168.1.10:45831' },
    });
    expect(database.pairings.list('paired')).toMatchObject([{
      id: 'companion:device-1',
      deviceId: 'device-1',
      state: 'paired',
    }]);
    database.close();
  });

  it('blocks opening a database from a newer schema', () => {
    const filePath = path.join(temporaryDirectory(), 'future.sqlite3');
    const raw = new DatabaseSync(filePath);
    raw.exec('PRAGMA user_version = 999');
    raw.close();
    expect(() => new JarvisDatabase(filePath, 'test')).toThrow(UnsupportedSchemaVersionError);
  });

  it('rejects an applied migration whose checksum was changed', () => {
    const filePath = path.join(temporaryDirectory(), 'tampered.sqlite3');
    const database = new JarvisDatabase(filePath, 'test');
    database.connection.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = 1').run('tampered');
    database.close();
    expect(() => new JarvisDatabase(filePath, 'test')).toThrow(/checksum/);
  });

  it('creates restorable SQLite backups and deterministic JSON exports', async () => {
    const directory = temporaryDirectory();
    const database = new JarvisDatabase(path.join(directory, 'source.sqlite3'), 'test');
    database.settings.set('server', 'theme', 'arc-reactor');
    const backupPath = path.join(directory, 'exports', 'backup.sqlite3');
    const exportPath = path.join(directory, 'exports', 'export.json');
    expect(await database.backup(backupPath)).toBeGreaterThan(0);
    database.exportJson(exportPath);
    database.close();

    const restored = new JarvisDatabase(backupPath, 'test');
    expect(restored.settings.get('server', 'theme')?.value).toBe('arc-reactor');
    restored.close();
    const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as { data: { settings: unknown[] } };
    expect(exported.data.settings).toHaveLength(1);
  });

  it('backs up and idempotently imports valid legacy JSON', () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'legacy.json');
    writeFileSync(sourcePath, JSON.stringify({ theme: 'midnight' }), { mode: 0o600 });
    const database = new JarvisDatabase(path.join(directory, 'jarvis.sqlite3'), 'test');
    const migrate = () => migrateLegacyJson({
      database,
      sourceId: 'legacy-settings',
      sourcePath,
      backupDirectory: path.join(directory, 'backups'),
      quarantineDirectory: path.join(directory, 'quarantine'),
      importRecord: (record) => database.settings.setMany('server', record),
    });
    const first = migrate();
    expect(first).toMatchObject({ state: 'imported', alreadyProcessed: false });
    expect(readFileSync(first.backupPath!, 'utf8')).toContain('midnight');
    writeFileSync(sourcePath, JSON.stringify({ theme: 'crimson' }), { mode: 0o600 });
    expect(migrate()).toMatchObject({ state: 'imported', alreadyProcessed: true });
    expect(database.settings.get('server', 'theme')?.value).toBe('midnight');
    database.close();
  });

  it('quarantines malformed legacy JSON without partial imports', () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'legacy.json');
    writeFileSync(sourcePath, '{not-json', { mode: 0o600 });
    const database = new JarvisDatabase(path.join(directory, 'jarvis.sqlite3'), 'test');
    const result = migrateLegacyJson({
      database,
      sourceId: 'legacy-settings',
      sourcePath,
      backupDirectory: path.join(directory, 'backups'),
      quarantineDirectory: path.join(directory, 'quarantine'),
      importRecord: (record) => database.settings.setMany('server', record),
    });
    expect(result).toMatchObject({ state: 'quarantined', alreadyProcessed: false });
    expect(readFileSync(result.quarantinePath!, 'utf8')).toBe('{not-json');
    expect(database.settings.getAll('server')).toEqual({});
    database.close();
  });

  it('does not reinterpret a source recorded as missing on a later restart', () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'legacy.json');
    const filePath = path.join(directory, 'jarvis.sqlite3');
    const first = new JarvisDatabase(filePath, 'test');
    const options = {
      database: first,
      sourceId: 'legacy-settings',
      sourcePath,
      backupDirectory: path.join(directory, 'backups'),
      quarantineDirectory: path.join(directory, 'quarantine'),
      importRecord: (record: Readonly<Record<string, unknown>>) => first.settings.setMany('server', record),
    };
    expect(migrateLegacyJson(options)).toMatchObject({ state: 'missing', alreadyProcessed: false });
    writeFileSync(sourcePath, JSON.stringify({ theme: 'stale' }), { mode: 0o600 });
    expect(migrateLegacyJson(options)).toMatchObject({ state: 'missing', alreadyProcessed: true });
    expect(first.settings.getAll('server')).toEqual({});
    first.close();
  });
});
