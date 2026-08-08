import { createHash } from 'node:crypto';

export interface DatabaseMigration {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  app_version TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
) STRICT;

CREATE TABLE secret_refs (
  id TEXT PRIMARY KEY,
  integration TEXT NOT NULL,
  vault_service TEXT NOT NULL,
  vault_account TEXT NOT NULL,
  configured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  UNIQUE (vault_service, vault_account)
) STRICT;

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  friendly_name TEXT NOT NULL,
  platform TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE pairings (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  certificate_fingerprint TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'paired', 'revoked', 'expired')),
  paired_at TEXT,
  revoked_at TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE capability_grants (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  scope TEXT NOT NULL,
  capability TEXT NOT NULL,
  target TEXT,
  source TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT,
  profile TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE tool_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  target TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  target_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'consumed', 'expired', 'rejected')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'local',
  due_date TEXT NOT NULL,
  text TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  time_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE integration_state (
  integration TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (integration, key)
) STRICT;

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  hardware_profile TEXT,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  installed_at TEXT,
  last_verified_at TEXT,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE migration_sources (
  source_id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_sha256 TEXT,
  state TEXT NOT NULL CHECK (state IN ('imported', 'quarantined', 'missing')),
  backup_path TEXT,
  detail TEXT,
  processed_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_pairings_device ON pairings(device_id);
CREATE INDEX idx_grants_lookup ON capability_grants(actor, capability, revoked_at, expires_at);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_tool_runs_created ON tool_runs(created_at);
CREATE INDEX idx_approvals_state_expiry ON approvals(state, expires_at);
CREATE INDEX idx_tasks_date ON tasks(scope, due_date);

PRAGMA user_version = 1;
`;

const SECURITY_AUDIT_SQL = `
CREATE TABLE security_audit (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'issued', 'consumed', 'expired', 'revoked', 'failed')),
  reason TEXT NOT NULL,
  remote_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE INDEX idx_security_audit_time ON security_audit(occurred_at DESC);
CREATE INDEX idx_security_audit_actor ON security_audit(actor_id, occurred_at DESC);

PRAGMA user_version = 2;
`;

function checksum(sql: string): string {
  return createHash('sha256').update(sql.trim()).digest('hex');
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    id: 1,
    name: 'initial-core-schema',
    sql: INITIAL_SCHEMA_SQL,
    checksum: checksum(INITIAL_SCHEMA_SQL),
  },
  {
    id: 2,
    name: 'security-audit-log',
    sql: SECURITY_AUDIT_SQL,
    checksum: checksum(SECURITY_AUDIT_SQL),
  },
] as const;

export const LATEST_SCHEMA_VERSION = DATABASE_MIGRATIONS.at(-1)?.id ?? 0;
