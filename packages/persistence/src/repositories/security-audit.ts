import type { DatabaseSync } from 'node:sqlite';

export type SecurityAuditDecision = 'allowed' | 'denied' | 'issued' | 'revoked' | 'failed';

export interface SecurityAuditRecord {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly decision: SecurityAuditDecision;
  readonly reason: string;
  readonly remoteHash: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AppendSecurityAudit {
  readonly id: string;
  readonly actorId?: string | null;
  readonly action: string;
  readonly resource: string;
  readonly decision: SecurityAuditDecision;
  readonly reason: string;
  readonly remoteHash?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface SecurityAuditRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  action: string;
  resource: string;
  decision: SecurityAuditDecision;
  reason: string;
  remote_hash: string | null;
  metadata_json: string;
}

export class SecurityAuditRepository {
  constructor(private readonly database: DatabaseSync) {}

  append(input: AppendSecurityAudit): SecurityAuditRecord {
    const occurredAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO security_audit (
        id, occurred_at, actor_id, action, resource, decision, reason, remote_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      occurredAt,
      input.actorId ?? null,
      input.action,
      input.resource,
      input.decision,
      input.reason,
      input.remoteHash ?? null,
      JSON.stringify(input.metadata ?? {}),
    );
    this.database.prepare(`
      DELETE FROM security_audit
      WHERE id IN (
        SELECT id FROM security_audit
        ORDER BY occurred_at DESC, id DESC
        LIMIT -1 OFFSET 10000
      )
    `).run();
    return this.get(input.id)!;
  }

  get(id: string): SecurityAuditRecord | null {
    const row = this.database.prepare(`
      SELECT id, occurred_at, actor_id, action, resource, decision, reason, remote_hash, metadata_json
      FROM security_audit WHERE id = ?
    `).get(id) as unknown as SecurityAuditRow | undefined;
    return row ? this.map(row) : null;
  }

  list(limit = 100): SecurityAuditRecord[] {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.database.prepare(`
      SELECT id, occurred_at, actor_id, action, resource, decision, reason, remote_hash, metadata_json
      FROM security_audit ORDER BY occurred_at DESC, id DESC LIMIT ?
    `).all(bounded) as unknown as SecurityAuditRow[];
    return rows.map((row) => this.map(row));
  }

  private map(row: SecurityAuditRow): SecurityAuditRecord {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
      action: row.action,
      resource: row.resource,
      decision: row.decision,
      reason: row.reason,
      remoteHash: row.remote_hash,
      metadata: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {},
    };
  }
}
