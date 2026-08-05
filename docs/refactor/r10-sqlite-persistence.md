# R10 SQLite persistence and recovery

Status: implemented and locally verified on 2026-08-05.

## Runtime decision

Jarvis uses the runtime-provided `node:sqlite` API instead of a third-party native add-on. The lockfile resolves Electron 36.9.5 with embedded Node 22.19.0, and the supported development runtime is Node 22.23.1. Both expose `DatabaseSync` and the SQLite backup API. This avoids a separate native ABI, Electron rebuild, and platform-specific binary in the macOS arm64 and Windows x64 packages.

`packages/persistence` is runtime-agnostic application infrastructure with no side effects at import time. During the transitional architecture, the local Next.js/Core process is the sole database writer. Electron supplies its user-data directory and app version to that process; the renderer and future Python AI service never open the database.

## Schema and repositories

Schema version 1 creates the plan's complete initial table set: `schema_migrations`, `settings`, `secret_refs`, `devices`, `pairings`, `capability_grants`, `sessions`, `messages`, `tool_runs`, `approvals`, `tasks`, `integration_state`, and `model_profiles`. `migration_sources` records compatibility-import state. Foreign keys, bounded busy waits, WAL for file databases, and normal synchronous durability are enabled at connection startup.

Migration SQL has a checked-in SHA-256 checksum and runs transactionally. Jarvis refuses modified applied migrations and blocks a binary whose supported schema is older than the database. Settings and task repositories use prepared statements and transactions; local calendar tasks now round-trip through `/api/tasks` and the shared query cache instead of remaining authoritative browser data.

## Compatibility migration

On first database open, Jarvis handles `jarvis-server-settings.json` as follows:

1. Copy the source into a timestamped, permission-restricted migration-backup directory.
2. Record the absolute source/backup paths and SHA-256 in a restricted manifest.
3. Validate and import recognized non-secret settings in one transaction.
4. Record the source and checksum so restart is idempotent.
5. Quarantine malformed or rejected input and expose only its error state through diagnostics.

The renderer performs the equivalent one-time import for valid non-secret settings and local calendar tasks from `localStorage`. Tasks are removed from the legacy key only after the Core write succeeds. During this compatibility release, reads can still recover credential values from the legacy settings file/local cache, but non-secret server changes write only to SQLite. R11 moves those remaining credentials into the OS vault and removes the compatibility secret overlay. Raw API keys, Home Assistant tokens, and private calendar URLs are never inserted into SQLite.

## Backup, export, and diagnostics

The desktop-authenticated `/api/storage` endpoint reports schema version, integrity check, journal mode, applied migrations, and legacy-source states. Its explicit recovery action writes a consistent SQLite online backup and a readable JSON export under the application data `exports` directory. The System settings screen exposes both checks; callers cannot select arbitrary output paths.

Local evidence: 20 test files and 144 tests pass. Persistence tests cover fresh migration, transactional rollback, restart, task replacement, future-schema downgrade blocking, checksum tampering, backup restore, JSON export, idempotent/missing legacy sources, and malformed-data quarantine. Core-store tests prove secret exclusion, dual-read/single-write behavior, restart, and compatibility secret merging. The unchanged 63-warning lint ratchet, TypeScript, all 50 inventoried routes, the Electron build, and the Next production build are green. A packaged standalone-server drill wrote settings and tasks, restarted, preserved the non-secret theme and task, merged the compatibility secret at the API boundary, returned `quick_check=ok`, created both recovery files, confirmed `0600` database/WAL/export permissions, and confirmed the raw secret was absent from SQLite.
