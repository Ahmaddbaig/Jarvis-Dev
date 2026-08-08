import type { DatabaseSync } from 'node:sqlite';

export interface SecretRef {
  readonly id: string;
  readonly integration: string;
  readonly vaultService: string;
  readonly vaultAccount: string;
  readonly configuredAt: string;
  readonly updatedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface SecretRefRow {
  id: string;
  integration: string;
  vault_service: string;
  vault_account: string;
  configured_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface PutSecretRef {
  readonly id: string;
  readonly integration: string;
  readonly vaultService: string;
  readonly vaultAccount: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function assertIdentifier(label: string, value: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) {
    throw new Error(`${label} must be a safe identifier containing 1-128 characters.`);
  }
}

export class SecretRefsRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(id: string): SecretRef | null {
    assertIdentifier('Secret reference ID', id);
    const row = this.database.prepare(`
      SELECT id, integration, vault_service, vault_account, configured_at, updated_at, metadata_json
      FROM secret_refs
      WHERE id = ?
    `).get(id) as unknown as SecretRefRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  list(): SecretRef[] {
    const rows = this.database.prepare(`
      SELECT id, integration, vault_service, vault_account, configured_at, updated_at, metadata_json
      FROM secret_refs
      ORDER BY id
    `).all() as unknown as SecretRefRow[];
    return rows.map((row) => this.mapRow(row));
  }

  put(input: PutSecretRef): SecretRef {
    for (const [label, value] of [
      ['Secret reference ID', input.id],
      ['Secret integration', input.integration],
      ['Vault service', input.vaultService],
      ['Vault account', input.vaultAccount],
    ] as const) assertIdentifier(label, value);
    const metadata = JSON.stringify(input.metadata ?? {});
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO secret_refs (
        id, integration, vault_service, vault_account, configured_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        integration = excluded.integration,
        vault_service = excluded.vault_service,
        vault_account = excluded.vault_account,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      input.id,
      input.integration,
      input.vaultService,
      input.vaultAccount,
      now,
      now,
      metadata,
    );
    return this.get(input.id)!;
  }

  delete(id: string): boolean {
    assertIdentifier('Secret reference ID', id);
    return this.database.prepare('DELETE FROM secret_refs WHERE id = ?').run(id).changes > 0;
  }

  private mapRow(row: SecretRefRow): SecretRef {
    const metadata = JSON.parse(row.metadata_json) as unknown;
    return {
      id: row.id,
      integration: row.integration,
      vaultService: row.vault_service,
      vaultAccount: row.vault_account,
      configuredAt: row.configured_at,
      updatedAt: row.updated_at,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : {},
    };
  }
}
