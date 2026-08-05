import type { DatabaseSync } from 'node:sqlite';

export interface StoredSetting {
  readonly scope: string;
  readonly key: string;
  readonly value: unknown;
  readonly schemaVersion: number;
  readonly updatedAt: string;
}

interface StoredSettingRow {
  scope: string;
  key: string;
  value_json: string;
  schema_version: number;
  updated_at: string;
}

function assertIdentifier(label: string, value: string): void {
  if (!value.trim() || value.length > 128) {
    throw new Error(`${label} must contain between 1 and 128 characters.`);
  }
}

function serializeSetting(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Settings values must be JSON serializable.');
  return serialized;
}

export class SettingsRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(scope: string, key: string): StoredSetting | null {
    assertIdentifier('Settings scope', scope);
    assertIdentifier('Settings key', key);
    const row = this.database.prepare(`
      SELECT scope, key, value_json, schema_version, updated_at
      FROM settings
      WHERE scope = ? AND key = ?
    `).get(scope, key) as unknown as StoredSettingRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getAll(scope: string): Record<string, unknown> {
    assertIdentifier('Settings scope', scope);
    const rows = this.database.prepare(`
      SELECT scope, key, value_json, schema_version, updated_at
      FROM settings
      WHERE scope = ?
      ORDER BY key
    `).all(scope) as unknown as StoredSettingRow[];
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json) as unknown]));
  }

  set(scope: string, key: string, value: unknown, schemaVersion = 1): void {
    this.setMany(scope, { [key]: value }, schemaVersion);
  }

  setMany(scope: string, values: Readonly<Record<string, unknown>>, schemaVersion = 1): void {
    assertIdentifier('Settings scope', scope);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new Error('Settings schema version must be a positive integer.');
    }
    const entries = Object.entries(values);
    for (const [key] of entries) assertIdentifier('Settings key', key);
    if (entries.length === 0) return;

    const now = new Date().toISOString();
    const statement = this.database.prepare(`
      INSERT INTO settings (scope, key, value_json, schema_version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET
        value_json = excluded.value_json,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    `);
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of entries) {
        statement.run(scope, key, serializeSetting(value), schemaVersion, now);
      }
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  delete(scope: string, key: string): boolean {
    assertIdentifier('Settings scope', scope);
    assertIdentifier('Settings key', key);
    return this.database.prepare('DELETE FROM settings WHERE scope = ? AND key = ?')
      .run(scope, key).changes > 0;
  }

  private mapRow(row: StoredSettingRow): StoredSetting {
    return {
      scope: row.scope,
      key: row.key,
      value: JSON.parse(row.value_json) as unknown,
      schemaVersion: row.schema_version,
      updatedAt: row.updated_at,
    };
  }
}
