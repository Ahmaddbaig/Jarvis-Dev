# R11: OS credential vault and redacted configuration APIs

R11 makes Jarvis Core the sole owner of long-lived credentials. The renderer may submit a value during an explicit setup action, but persisted settings and status responses contain only configured/not-configured state. SQLite stores stable secret references and non-secret integration metadata; it never stores raw credential values.

## Storage ownership

| Credential | Durable owner | Renderer/API visibility |
| --- | --- | --- |
| OpenAI and Anthropic API keys | macOS Keychain, Windows Credential Manager, or Linux Secret Service | configured flag only |
| Home Assistant token | OS vault | configured flag only after setup |
| Private iCal feed URL | OS vault | configured flag only |
| Bambu access/refresh session | OS vault | expiry/authenticated state only |
| Companion bearer token | OS vault, keyed by a SHA-256-derived device account | never returned; public device DTO only |
| Chrome extension token | raw token remains extension-local; SHA-256 hash and pairing metadata are in SQLite | pairing status only |
| Google OAuth client JSON | OS vault | configured flag and redacted project/client metadata |
| Google provider access/refresh tokens | provider-owned files under `JARVIS_DATA_DIR`, directories `0700`, files `0600`, with opaque SQLite references | authenticated flag only; paths are not returned |
| Companion TLS private key | companion application-data file written `0600` inside a `0700` directory | never |

The Google MCP packages require filesystem paths. Jarvis therefore materializes the OAuth client file with mode `0600` only while starting or authorizing a provider process, then removes it. Provider token files use the refactor plan's approved protected-store exception and are permission-hardened whenever status is checked.

## Public boundaries

- `/api/credentials` is desktop-bearer-only. `GET` returns flags; `PUT` and `DELETE` mutate the OS vault.
- `/api/settings` rejects embedded credentials. Its response combines non-secret SQLite settings with credential flags.
- OpenAI Realtime signaling is proxied through `/api/voice/realtime`; the browser never calls OpenAI with a bearer key.
- Image generation, X-ray, Computer Use, voice chat, Home Assistant, and iCal resolve credentials in server code.
- The local Computer Use helper receives its provider credential through stdin, not argv.
- Google credential mutations, service startup, and OAuth launch require the Electron desktop bearer.

## Migration behavior

Migration sources are processed idempotently through `migration_sources`:

1. The original file is hashed and copied into a timestamped `0700` backup directory with `0600` contents and a manifest.
2. Values are validated and written to the vault with immediate read-back verification.
3. Non-secret companion/Chrome pairing metadata is written transactionally to SQLite.
4. Only after successful import are sensitive fields removed from compatibility files (or the dedicated secret file removed).
5. Malformed or rejected JSON is copied to the migration quarantine and reported through storage diagnostics.

Covered legacy sources are `jarvis-server-settings.json`, renderer `localStorage`, `.bambu-token.json`, `jarvis-companions.json`, `jarvis-chrome-control.json`, and shared/legacy Google OAuth credential files. Renderer plaintext is deleted only after the vault write succeeds or an existing vault reference is confirmed.

## Verification

- `npm run check` covers contracts, repository behavior, migration idempotency, redacted APIs, subprocess argv, and source-level secret boundaries.
- `tests/integrationSecretMigration.test.ts` proves Bambu, Companion, Chrome, and Google migrations against isolated stores.
- `tests/secretVault.test.ts` proves macOS and Windows adapters pass secret values through stdin rather than process arguments.
- The macOS adapter was smoke-tested with a temporary Keychain item and the item was deleted afterward.
- Next standalone and Electron builds remain required gates because vault code is server-only and must not enter renderer bundles.

## Risk and rollback

The primary risk is an unavailable or locked platform credential service. Jarvis fails closed: the integration reports unconfigured/unavailable and does not fall back to plaintext. Migration backups permit manual recovery without placing values in SQLite exports. Rolling back application code does not delete vault items; compatibility backups remain permission-restricted until the R16 rollback drill and cleanup decision.

Platform behavior is based on the official [Electron safeStorage security notes](https://www.electronjs.org/docs/latest/api/safe-storage), macOS `security` CLI, Windows Credential Manager APIs, and Secret Service tooling. `keytar` was not introduced because its upstream repository is archived.
