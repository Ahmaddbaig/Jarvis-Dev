import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_MIGRATIONS, JarvisDatabase, LATEST_SCHEMA_VERSION } from '../packages/persistence/src';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-release-rollback-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createSchemaOneDatabase(filePath: string): void {
  const migration = DATABASE_MIGRATIONS[0];
  const database = new DatabaseSync(filePath);
  database.exec(migration.sql);
  database.prepare(`
    INSERT INTO schema_migrations (id, name, checksum, applied_at, app_version)
    VALUES (?, ?, ?, ?, ?)
  `).run(migration.id, migration.name, migration.checksum, '2026-08-05T00:00:00.000Z', '1.0.0');
  database.prepare(`
    INSERT INTO settings (scope, key, value_json, schema_version, updated_at)
    VALUES (?, ?, ?, 1, ?)
  `).run('server', 'theme', JSON.stringify('rollback-safe'), '2026-08-05T00:00:00.000Z');
  database.close();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release migration and rollback drill', () => {
  it('upgrades once, restarts, exports, and restores the automatic pre-migration snapshot', () => {
    const directory = temporaryDirectory();
    const activePath = path.join(directory, 'jarvis-core.sqlite3');
    createSchemaOneDatabase(activePath);

    const upgraded = new JarvisDatabase(activePath, '1.1.0-release');
    expect(upgraded.diagnostics()).toMatchObject({ schemaVersion: LATEST_SCHEMA_VERSION, integrity: 'ok' });
    expect(upgraded.settings.get('server', 'theme')?.value).toBe('rollback-safe');
    upgraded.exportJson(path.join(directory, 'export', 'jarvis.json'));
    upgraded.close();

    const backups = readdirSync(path.join(directory, 'migration-backups'))
      .filter((name) => name.endsWith('.sqlite3'));
    expect(backups).toHaveLength(1);
    const backupBytes = readFileSync(path.join(directory, 'migration-backups', backups[0]));
    const expectedChecksum = createHash('sha256').update(backupBytes).digest('hex');
    expect(readFileSync(path.join(directory, 'migration-backups', `${backups[0]}.sha256`), 'utf8'))
      .toBe(`${expectedChecksum}  ${backups[0]}\n`);

    const restarted = new JarvisDatabase(activePath, '1.1.0-release');
    expect(restarted.diagnostics().migrations).toHaveLength(LATEST_SCHEMA_VERSION);
    restarted.close();
    expect(readdirSync(path.join(directory, 'migration-backups')).filter((name) => name.endsWith('.sqlite3'))).toHaveLength(1);

    const rawBackup = new DatabaseSync(path.join(directory, 'migration-backups', backups[0]), { readOnly: true });
    expect((rawBackup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    rawBackup.close();

    copyFileSync(path.join(directory, 'migration-backups', backups[0]), activePath);
    const priorCompatibleReader = new DatabaseSync(activePath, { readOnly: true });
    expect((priorCompatibleReader.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    expect((priorCompatibleReader.prepare(`
      SELECT value_json FROM settings WHERE scope = ? AND key = ?
    `).get('server', 'theme') as { value_json: string }).value_json).toBe(JSON.stringify('rollback-safe'));
    priorCompatibleReader.close();

    const exported = JSON.parse(readFileSync(path.join(directory, 'export', 'jarvis.json'), 'utf8')) as {
      data: { settings: unknown[] };
    };
    expect(exported.data.settings).toHaveLength(1);
  });

  it('refuses a corrupt database without rewriting the source bytes', () => {
    const directory = temporaryDirectory();
    const activePath = path.join(directory, 'jarvis-core.sqlite3');
    createSchemaOneDatabase(activePath);
    const activeBytes = readFileSync(activePath);
    const filePath = path.join(directory, 'corrupt-recovery-candidate.sqlite3');
    const corrupt = Buffer.from('not-a-sqlite-database\0with-bounded-test-data');
    writeFileSync(filePath, corrupt);
    expect(() => new JarvisDatabase(filePath, '1.1.0-release')).toThrow();
    expect(readFileSync(filePath)).toEqual(corrupt);
    expect(readFileSync(activePath)).toEqual(activeBytes);
    expect(existsSync(path.join(directory, 'migration-backups'))).toBe(false);
  });
});
