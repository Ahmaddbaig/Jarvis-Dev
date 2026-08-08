# R16 — native release readiness, rollback, and compatibility cleanup

Status: implemented and locally verified on macOS arm64 on 2026-08-05. Windows x64 and experimental Linux x64 execute the same source, build, and test gates in CI. Distribution tags additionally require native signing credentials and signature verification.

## Supported release matrix

| Platform | Architecture | Support | Native artifacts | Distribution requirement |
| --- | --- | --- | --- | --- |
| macOS 12+ | arm64 | Stable | DMG and ZIP | Developer ID signature, hardened runtime, and notarization |
| Windows 10+ | x64 | Stable | NSIS installer and ZIP | Authenticode signature |
| Linux | x64 | Experimental | AppImage | Build and smoke gates; no stable-support promise |

The release toolchain is pinned to Electron 43.3.0, electron-builder 26.15.3, and Next.js 16.3.0. CI builds with Node 22 and Python 3.12; Electron embeds Node 24.18.1. Native modules used at runtime (`sharp`, `@jitsi/robotjs`, and the Companion screenshot stack) are production dependencies so the packager cannot prune them.

## Required release gates

Run these gates from a clean checkout with the supported Node and Python versions:

```sh
npm ci
npm run ai:setup
npm run release:supply-chain
npm audit --audit-level=high
npm run check
npm run build
npm run ai:smoke
npm run release:smoke
npm run release:evidence
```

`npm run check` covers the TypeScript and Python suites, the warning-budgeted lint gate, Ruff, mypy, generated Next types, route-inventory drift, remote-resource contracts, and release policy. The supply-chain gate validates lockfile registry integrity, pinned Git dependencies, production licenses, and source secret patterns without printing candidate values.

The evidence step emits a permission-restricted artifact manifest and CycloneDX 1.6 SBOM under `.build/release-evidence`. The manifest identifies the Git revision and dirty state, application and protocol versions, database schema, build and embedded runtimes, Python pins, model profile IDs, resource hashes, installer hashes, and release policy. Packaged diagnostics expose this identity without exposing secrets.

## Native lifecycle evidence

The frozen FastAPI sidecar is exercised across three cold starts with authenticated and unauthenticated health checks, protocol/build assertions, token-leak checks, and startup, latency, and memory budgets. The final local macOS arm64 run completed with an 848.2 ms maximum cold start, 6.7 ms maximum health p95, and approximately 60.7 MB peak RSS.

The pruned Next standalone runtime is 133 MiB and completed its final local boot and diagnostics drill in 542.5 ms. A separately launched unpacked desktop candidate booted the embedded server and supervised AI engine, reported its release identity and required Chrome/AI resources, and exited through the production shutdown path in 648.3 ms. Shutdown removed the AI session descriptor. None of these smoke tests provides an OpenAI credential.

## Signing and candidate workflow

`.github/workflows/release-candidates.yml` builds macOS arm64 and Windows x64 candidates from the selected branches and `v*` tags. Branch builds may be unsigned for test evidence. Tags force code signing, require notarization credentials on macOS, reject missing credentials before packaging, verify the resulting native signatures, execute the packaged lifecycle smoke test, and upload the candidates with the external manifest and SBOM.

Credential names are documented in the workflow, but values belong only in GitHub Actions secrets. This machine has no release certificate, so the local candidates are intentionally unsigned and are not distributable releases.

## Upgrade, migration, and rollback drill

Before the first pending database migration, the Core creates a permission-restricted SQLite `VACUUM INTO` snapshot beside the database. It does so once for that schema transition, records a SHA-256 checksum, and leaves the separately managed model directories untouched. Startup refuses a future schema or a modified applied migration.

The automated rollback drill proves this sequence:

1. Open a schema-1 database with the current binary.
2. Create exactly one pre-migration snapshot and migrate transactionally to schema 2.
3. Restart and confirm no duplicate snapshot is created.
4. Export a readable recovery bundle from the migrated database.
5. Restore the pre-migration snapshot with the compatible prior binary path.
6. Refuse a corrupt recovery candidate without mutating the live database.

Operators should stop Jarvis, preserve the live database and its WAL/SHM files, verify the selected snapshot checksum, restore only with a binary that supports the snapshot schema, start offline, run the storage integrity check, and only then reconnect integrations. The current application can create explicit SQLite backups and JSON exports through the desktop-authenticated `/api/storage` endpoint.

## Install, restart, update, export, and uninstall behavior

- A fresh install writes mutable state only below Electron's per-user data directory. Packaged production builds retain the `Jarvis` identity and never use the development identity.
- Restart recreates the loopback Core and supervised AI sidecar with new private session credentials. Stale descriptors are rejected and normal shutdown removes them.
- Automatic updates remain disabled. A future updater must verify signatures, take a migration backup, retain a last-known-good candidate, and use a staged rollout before this policy can be changed.
- Installer or update operations never replace or delete separately managed model directories.
- The storage endpoint provides operator-controlled database backup and readable export operations without accepting arbitrary output paths.
- Windows NSIS uninstall preserves application data. Removing a macOS application bundle does not remove its separate user-data directory.

## Compatibility exit criteria

Legacy settings, secret-vault, and remote-protocol readers remain only for the compatibility window declared in `packages/contracts/release-policy.json`: through one stable, signed release. They may be removed only after field telemetry or explicit migration diagnostics show no remaining legacy sources, rollback packages and documentation have been retained, and the supported clients have adopted the shared protocol.

R16 also removes obsolete duplicate-lock behavior, direct renderer ownership of durable settings, development identity leakage into packaged builds, and unrestricted standalone file tracing. Release-policy validation prevents these invariants from silently regressing.
