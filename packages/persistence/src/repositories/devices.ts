import type { DatabaseSync } from 'node:sqlite';

export interface DeviceRecord {
  readonly id: string;
  readonly kind: string;
  readonly friendlyName: string;
  readonly platform: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface PutDevice {
  readonly id: string;
  readonly kind: string;
  readonly friendlyName: string;
  readonly platform?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface DeviceRow {
  id: string;
  kind: string;
  friendly_name: string;
  platform: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

function metadata(value: string): Readonly<Record<string, unknown>> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

export class DevicesRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(id: string): DeviceRecord | null {
    const row = this.database.prepare(`
      SELECT id, kind, friendly_name, platform, created_at, updated_at, metadata_json
      FROM devices WHERE id = ?
    `).get(id) as unknown as DeviceRow | undefined;
    return row ? this.map(row) : null;
  }

  list(kind?: string): DeviceRecord[] {
    const rows = (kind
      ? this.database.prepare(`
          SELECT id, kind, friendly_name, platform, created_at, updated_at, metadata_json
          FROM devices WHERE kind = ? ORDER BY friendly_name, id
        `).all(kind)
      : this.database.prepare(`
          SELECT id, kind, friendly_name, platform, created_at, updated_at, metadata_json
          FROM devices ORDER BY kind, friendly_name, id
        `).all()) as unknown as DeviceRow[];
    return rows.map((row) => this.map(row));
  }

  put(input: PutDevice): DeviceRecord {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO devices (id, kind, friendly_name, platform, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        friendly_name = excluded.friendly_name,
        platform = excluded.platform,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      input.id,
      input.kind,
      input.friendlyName,
      input.platform ?? null,
      now,
      now,
      JSON.stringify(input.metadata ?? {}),
    );
    return this.get(input.id)!;
  }

  delete(id: string): boolean {
    return this.database.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0;
  }

  private map(row: DeviceRow): DeviceRecord {
    return {
      id: row.id,
      kind: row.kind,
      friendlyName: row.friendly_name,
      platform: row.platform,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: metadata(row.metadata_json),
    };
  }
}
