import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { JarvisDatabase } from './database';

export interface LegacyJsonMigrationOptions {
  readonly database: JarvisDatabase;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly backupDirectory: string;
  readonly quarantineDirectory: string;
  readonly importRecord: (record: Readonly<Record<string, unknown>>) => void;
}

export interface LegacyJsonMigrationResult {
  readonly state: 'imported' | 'quarantined' | 'missing';
  readonly sourceSha256?: string;
  readonly backupPath?: string;
  readonly quarantinePath?: string;
  readonly alreadyProcessed: boolean;
}

interface MigrationSourceRow {
  state: 'imported' | 'quarantined' | 'missing';
  source_sha256: string | null;
  backup_path: string | null;
}

function safeTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-');
}

function writeRestrictedJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.partial`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filePath);
  chmodSync(filePath, 0o600);
}

function recordSource(
  database: JarvisDatabase,
  sourceId: string,
  sourcePath: string,
  state: LegacyJsonMigrationResult['state'],
  sourceSha256?: string,
  backupPath?: string,
  detail?: string,
): void {
  database.connection.prepare(`
    INSERT INTO migration_sources (
      source_id, source_path, source_sha256, state, backup_path, detail, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_path = excluded.source_path,
      source_sha256 = excluded.source_sha256,
      state = excluded.state,
      backup_path = excluded.backup_path,
      detail = excluded.detail,
      processed_at = excluded.processed_at
  `).run(
    sourceId,
    sourcePath,
    sourceSha256 ?? null,
    state,
    backupPath ?? null,
    detail ?? null,
    new Date().toISOString(),
  );
}

export function migrateLegacyJson(options: LegacyJsonMigrationOptions): LegacyJsonMigrationResult {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(options.sourceId)) {
    throw new Error('Legacy migration source IDs must be filesystem-safe identifiers.');
  }
  const existing = options.database.connection.prepare(`
    SELECT state, source_sha256, backup_path
    FROM migration_sources
    WHERE source_id = ?
  `).get(options.sourceId) as unknown as MigrationSourceRow | undefined;
  if (existing) {
    return {
      state: existing.state,
      ...(existing.source_sha256 ? { sourceSha256: existing.source_sha256 } : {}),
      ...(existing.backup_path ? { backupPath: existing.backup_path } : {}),
      alreadyProcessed: true,
    };
  }

  if (!existsSync(options.sourcePath)) {
    recordSource(options.database, options.sourceId, options.sourcePath, 'missing');
    return { state: 'missing', alreadyProcessed: false };
  }

  const bytes = readFileSync(options.sourcePath);
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const stamp = safeTimestamp();
  const backupRoot = path.join(options.backupDirectory, `${stamp}-${options.sourceId}`);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupRoot, path.basename(options.sourcePath));
  copyFileSync(options.sourcePath, backupPath);
  chmodSync(backupPath, 0o600);
  writeRestrictedJson(path.join(backupRoot, 'manifest.json'), {
    version: 1,
    createdAt: new Date().toISOString(),
    sources: [{
      sourceId: options.sourceId,
      sourcePath: path.resolve(options.sourcePath),
      sourceSha256,
      backupPath: path.resolve(backupPath),
    }],
  });

  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Legacy JSON root must be an object.');
    }
    record = parsed as Record<string, unknown>;
  } catch (error) {
    mkdirSync(options.quarantineDirectory, { recursive: true, mode: 0o700 });
    const quarantinePath = path.join(
      options.quarantineDirectory,
      `${path.basename(options.sourcePath)}.${stamp}.invalid`,
    );
    copyFileSync(options.sourcePath, quarantinePath);
    chmodSync(quarantinePath, 0o600);
    const detail = error instanceof Error ? error.message : 'Legacy JSON could not be parsed.';
    recordSource(
      options.database,
      options.sourceId,
      options.sourcePath,
      'quarantined',
      sourceSha256,
      backupPath,
      detail,
    );
    return {
      state: 'quarantined',
      sourceSha256,
      backupPath,
      quarantinePath,
      alreadyProcessed: false,
    };
  }

  try {
    options.database.transaction(() => {
      options.importRecord(record);
      recordSource(
        options.database,
        options.sourceId,
        options.sourcePath,
        'imported',
        sourceSha256,
        backupPath,
      );
    });
  } catch (error) {
    mkdirSync(options.quarantineDirectory, { recursive: true, mode: 0o700 });
    const quarantinePath = path.join(
      options.quarantineDirectory,
      `${path.basename(options.sourcePath)}.${stamp}.rejected`,
    );
    copyFileSync(options.sourcePath, quarantinePath);
    chmodSync(quarantinePath, 0o600);
    const detail = error instanceof Error ? error.message : 'Legacy JSON failed validation.';
    recordSource(
      options.database,
      options.sourceId,
      options.sourcePath,
      'quarantined',
      sourceSha256,
      backupPath,
      detail,
    );
    return {
      state: 'quarantined',
      sourceSha256,
      backupPath,
      quarantinePath,
      alreadyProcessed: false,
    };
  }

  return { state: 'imported', sourceSha256, backupPath, alreadyProcessed: false };
}
