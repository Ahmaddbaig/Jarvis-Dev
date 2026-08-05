import type { DatabaseSync } from 'node:sqlite';

export type PairingState = 'pending' | 'paired' | 'revoked' | 'expired';

export interface PairingRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly certificateFingerprint: string | null;
  readonly state: PairingState;
  readonly pairedAt: string | null;
  readonly revokedAt: string | null;
  readonly expiresAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface PutPairing {
  readonly id: string;
  readonly deviceId: string;
  readonly certificateFingerprint?: string | null;
  readonly state: PairingState;
  readonly pairedAt?: string | null;
  readonly revokedAt?: string | null;
  readonly expiresAt?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface PairingRow {
  id: string;
  device_id: string;
  certificate_fingerprint: string | null;
  state: PairingState;
  paired_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  metadata_json: string;
}

export class PairingsRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(id: string): PairingRecord | null {
    const row = this.database.prepare(`
      SELECT id, device_id, certificate_fingerprint, state, paired_at, revoked_at, expires_at, metadata_json
      FROM pairings WHERE id = ?
    `).get(id) as unknown as PairingRow | undefined;
    return row ? this.map(row) : null;
  }

  list(state?: PairingState): PairingRecord[] {
    const rows = (state
      ? this.database.prepare(`
          SELECT id, device_id, certificate_fingerprint, state, paired_at, revoked_at, expires_at, metadata_json
          FROM pairings WHERE state = ? ORDER BY paired_at, id
        `).all(state)
      : this.database.prepare(`
          SELECT id, device_id, certificate_fingerprint, state, paired_at, revoked_at, expires_at, metadata_json
          FROM pairings ORDER BY paired_at, id
        `).all()) as unknown as PairingRow[];
    return rows.map((row) => this.map(row));
  }

  put(input: PutPairing): PairingRecord {
    this.database.prepare(`
      INSERT INTO pairings (
        id, device_id, certificate_fingerprint, state, paired_at, revoked_at, expires_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_id = excluded.device_id,
        certificate_fingerprint = excluded.certificate_fingerprint,
        state = excluded.state,
        paired_at = excluded.paired_at,
        revoked_at = excluded.revoked_at,
        expires_at = excluded.expires_at,
        metadata_json = excluded.metadata_json
    `).run(
      input.id,
      input.deviceId,
      input.certificateFingerprint ?? null,
      input.state,
      input.pairedAt ?? null,
      input.revokedAt ?? null,
      input.expiresAt ?? null,
      JSON.stringify(input.metadata ?? {}),
    );
    return this.get(input.id)!;
  }

  delete(id: string): boolean {
    return this.database.prepare('DELETE FROM pairings WHERE id = ?').run(id).changes > 0;
  }

  private map(row: PairingRow): PairingRecord {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    return {
      id: row.id,
      deviceId: row.device_id,
      certificateFingerprint: row.certificate_fingerprint,
      state: row.state,
      pairedAt: row.paired_at,
      revokedAt: row.revoked_at,
      expiresAt: row.expires_at,
      metadata: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {},
    };
  }
}
