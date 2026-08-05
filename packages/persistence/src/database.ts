import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATABASE_MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations';
import { SettingsRepository } from './repositories/settings';
import { TasksRepository } from './repositories/tasks';
import { SecretRefsRepository } from './repositories/secret-refs';
import { DevicesRepository } from './repositories/devices';
import { PairingsRepository } from './repositories/pairings';
import { SecurityAuditRepository } from './repositories/security-audit';

interface AppliedMigrationRow {
  id: number;
  name: string;
  checksum: string;
  applied_at: string;
  app_version: string;
}

export interface DatabaseDiagnostics {
  readonly path: string;
  readonly schemaVersion: number;
  readonly latestSchemaVersion: number;
  readonly integrity: string;
  readonly journalMode: string;
  readonly migrations: readonly {
    id: number;
    name: string;
    checksum: string;
    appliedAt: string;
    appVersion: string;
  }[];
  readonly migrationSources: readonly {
    sourceId: string;
    state: string;
    processedAt: string;
    detail?: string;
  }[];
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(found: number, supported: number) {
    super(`Database schema ${found} is newer than the supported schema ${supported}; downgrade is blocked.`);
    this.name = 'UnsupportedSchemaVersionError';
  }
}

export class JarvisDatabase {
  readonly settings: SettingsRepository;
  readonly tasks: TasksRepository;
  readonly secretRefs: SecretRefsRepository;
  readonly devices: DevicesRepository;
  readonly pairings: PairingsRepository;
  readonly securityAudit: SecurityAuditRepository;
  readonly connection: DatabaseSync;

  constructor(
    readonly filePath: string,
    private readonly appVersion: string,
  ) {
    if (filePath !== ':memory:') {
      mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      if (!existsSync(filePath)) closeSync(openSync(filePath, 'wx', 0o600));
    }
    this.connection = new DatabaseSync(filePath, { timeout: 5_000 });
    this.configure();
    this.applyMigrations();
    this.restrictDatabaseFiles();
    this.settings = new SettingsRepository(this.connection);
    this.tasks = new TasksRepository(this.connection);
    this.secretRefs = new SecretRefsRepository(this.connection);
    this.devices = new DevicesRepository(this.connection);
    this.pairings = new PairingsRepository(this.connection);
    this.securityAudit = new SecurityAuditRepository(this.connection);
  }

  transaction<T>(operation: () => T): T {
    if (this.connection.isTransaction) return operation();
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.connection.exec('COMMIT');
      this.restrictDatabaseFiles();
      return result;
    } catch (error) {
      if (this.connection.isTransaction) this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  diagnostics(): DatabaseDiagnostics {
    const integrityRow = this.connection.prepare('PRAGMA quick_check').get() as Record<string, unknown>;
    const journalRow = this.connection.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
    const migrations = this.appliedMigrations().map((row) => ({
      id: row.id,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
      appVersion: row.app_version,
    }));
    const sources = this.connection.prepare(`
      SELECT source_id, state, processed_at, detail
      FROM migration_sources
      ORDER BY processed_at, source_id
    `).all() as unknown as Array<{
      source_id: string;
      state: string;
      processed_at: string;
      detail: string | null;
    }>;
    return {
      path: this.filePath,
      schemaVersion: this.schemaVersion(),
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      integrity: String(Object.values(integrityRow)[0] ?? 'unknown'),
      journalMode: String(Object.values(journalRow)[0] ?? 'unknown'),
      migrations,
      migrationSources: sources.map((source) => ({
        sourceId: source.source_id,
        state: source.state,
        processedAt: source.processed_at,
        ...(source.detail ? { detail: source.detail } : {}),
      })),
    };
  }

  async backup(destination: string): Promise<number> {
    if (this.filePath === ':memory:' && destination === ':memory:') {
      throw new Error('Backup destination must be a file.');
    }
    const resolved = path.resolve(destination);
    if (this.filePath !== ':memory:' && resolved === path.resolve(this.filePath)) {
      throw new Error('Backup destination must differ from the active database.');
    }
    mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    const temporary = `${resolved}.partial`;
    rmSync(temporary, { force: true });
    try {
      const pages = await backup(this.connection, temporary);
      chmodSync(temporary, 0o600);
      renameSync(temporary, resolved);
      return pages;
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  exportJson(destination: string): void {
    const tables = [
      'schema_migrations', 'settings', 'secret_refs', 'devices', 'pairings',
      'capability_grants', 'sessions', 'messages', 'tool_runs', 'approvals',
      'tasks', 'integration_state', 'model_profiles', 'migration_sources', 'security_audit',
    ] as const;
    const data = Object.fromEntries(tables.map((table) => [
      table,
      this.connection.prepare(`SELECT * FROM ${table}`).all(),
    ]));
    const resolved = path.resolve(destination);
    mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    const temporary = `${resolved}.partial`;
    writeFileSync(temporary, `${JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporary, resolved);
  }

  close(): void {
    if (this.connection.isOpen) this.connection.close();
  }

  private configure(): void {
    this.connection.exec('PRAGMA foreign_keys = ON');
    this.connection.exec('PRAGMA busy_timeout = 5000');
    this.connection.exec('PRAGMA synchronous = NORMAL');
    if (this.filePath !== ':memory:') this.connection.exec('PRAGMA journal_mode = WAL');
  }

  private restrictDatabaseFiles(): void {
    if (this.filePath === ':memory:') return;
    for (const candidate of [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`]) {
      try {
        if (existsSync(candidate)) chmodSync(candidate, 0o600);
      } catch {
        // Windows does not implement POSIX permission bits; the user-data ACL remains authoritative.
      }
    }
  }

  private schemaVersion(): number {
    const row = this.connection.prepare('PRAGMA user_version').get() as Record<string, unknown>;
    return Number(Object.values(row)[0] ?? 0);
  }

  private appliedMigrations(): AppliedMigrationRow[] {
    return this.connection.prepare(`
      SELECT id, name, checksum, applied_at, app_version
      FROM schema_migrations
      ORDER BY id
    `).all() as unknown as AppliedMigrationRow[];
  }

  private applyMigrations(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        app_version TEXT NOT NULL
      ) STRICT
    `);
    const currentVersion = this.schemaVersion();
    if (currentVersion > LATEST_SCHEMA_VERSION) {
      throw new UnsupportedSchemaVersionError(currentVersion, LATEST_SCHEMA_VERSION);
    }

    const applied = new Map(this.appliedMigrations().map((migration) => [migration.id, migration]));
    for (const row of applied.values()) {
      const expected = DATABASE_MIGRATIONS.find((migration) => migration.id === row.id);
      if (!expected) throw new UnsupportedSchemaVersionError(row.id, LATEST_SCHEMA_VERSION);
      if (expected.checksum !== row.checksum || expected.name !== row.name) {
        throw new Error(`Database migration ${row.id} does not match the application migration checksum.`);
      }
    }

    for (const migration of DATABASE_MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection.prepare(`
          INSERT INTO schema_migrations (id, name, checksum, applied_at, app_version)
          VALUES (?, ?, ?, ?, ?)
        `).run(migration.id, migration.name, migration.checksum, new Date().toISOString(), this.appVersion);
      });
    }
  }
}
