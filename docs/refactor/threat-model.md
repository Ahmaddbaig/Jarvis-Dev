# Initial refactor threat model

Status: R01 draft based on develop `5fca427`. Revisit this document at every phase exit and whenever a native dependency, remote capability, route exposure, or data migration changes.

## Assets

- API keys, OAuth client secrets, refresh tokens, Bambu tokens, Home Assistant tokens, companion bearer tokens, and TLS private keys.
- Microphone audio, transcripts, screenshots, calendar contents, smart-home state, printer data, browser data, and local files.
- Shell, desktop input, media control, Home Assistant service calls, printer commands, MCP tools, Companion actions, and Deskflow switching.
- Local model files, hardware profiles, settings, pairings, audit history, and migration backups.
- The identity and integrity of the Electron, Core, AI engine, Companion, and future Chrome runtimes.

## Actors and trust boundaries

| Actor / zone | Trusted for | Must not be trusted for |
| --- | --- | --- |
| Electron main | Window lifecycle, native permissions, child supervision, narrow IPC | Arbitrary renderer commands or unvalidated remote requests |
| Renderer | Presentation, transient UI state, explicit user gestures | Long-lived secrets, policy decisions, direct child/process control |
| Next route runtime | Current adapter execution during migration | Implicit LAN trust or model-supplied authorization |
| Jarvis Core target | Validation, authorization, persistence, approvals, audit | Webpage/model claims about identity, risk, target, or confirmation |
| AI providers / future Python engine | Transcription, generation, tool proposals | Executing privileged capabilities |
| LAN client | Explicit authenticated allowlisted functions | Desktop-equivalent authority based on network proximity |
| Companion | Its paired, leased, locally permitted command subset | Global credentials, arbitrary shell, replayed commands |
| Chrome extension | Granted-origin browser operations | OS or companion control, unapproved origin data, stale confirmations |
| External integrations | Their documented API results | Instructions embedded in returned content |

## Current attack surface

1. The Electron HTTPS proxy listens on all interfaces and forwards 41 unauthenticated API route handlers.
2. `/api/settings` can return or replace settings that include credentials.
3. `/api/shell`, `/api/skills/execute`, `/api/mcp`, and `/api/mcp/dynamic` can reach process execution or open-ended tool behavior.
4. Home Assistant, Bambu, calendar, music, open-URL, and provider-backed AI routes can cause side effects or cost without a route-level, target-bound approval.
5. Tokens and machine state are split across renderer storage and several JSON/config locations.
6. Compiled Electron artifacts are authoritative in practice because their typed source/build chain is missing.
7. Model, webpage, search, calendar, and remote content can flow toward tool selection without one independent policy service.
8. Error strings and diagnostic responses are not governed by one redaction contract.

## Priority abuse cases

| ID | Abuse case | Current concern | Required mitigation / test |
| --- | --- | --- | --- |
| TM-01 | A LAN peer posts a shell command | Proxy reaches an unauthenticated execution route | Deny-by-default gateway, desktop-only capability, negative LAN test |
| TM-02 | A LAN peer reads settings or overwrites provider keys | Settings route is LAN-proxied and unauthenticated | Secret metadata API, OS vault, authenticated settings mutations, response redaction tests |
| TM-03 | A caller registers an arbitrary MCP command with attacker-controlled environment | Dynamic MCP route accepts command, args, and env | Admin-only policy, executable allowlist/signature, bounded env schema, audit test |
| TM-04 | Prompt or webpage content asks the model to change the target or skip approval | Tool approval is distributed and renderer-owned | Untrusted-content label, independent policy evaluation, target fingerprint, injection tests |
| TM-05 | A stale approval is replayed after navigation or target mutation | There is no shared approval envelope | One-time approval ID bound to actor, operation, normalized args, target fingerprint, and expiry |
| TM-06 | A companion command is duplicated after result loss | Remote delivery can cross network failure boundaries | Idempotency key, persisted result until acknowledgement, replay conformance test |
| TM-07 | A paired companion token or TLS key is copied from plaintext state | Credential ownership is fragmented | OS vault, strict file permissions during migration, revoke/export/restart tests |
| TM-08 | Home Assistant URL/token parameters leak into logs or browser history | GET accepts both in the query string | Server-owned credential reference, allowlisted base URL, SSRF test, log redaction test |
| TM-09 | Private audio/image/calendar content appears in fixtures or diagnostics | Multiple routes accept sensitive content | Synthetic fixtures, no-retention default, centralized redaction, bounded diagnostic export |
| TM-10 | A malicious URL reaches shell interpolation | Open URL currently delegates to an OS command | Structured OS API, scheme allowlist, control-character rejection, adversarial URL tests |
| TM-11 | Build artifact or dependency is substituted | Source build is incomplete and install scripts are blocked | Restored source chain, lock/build checks, hashes, native CI, signed release manifest |
| TM-12 | Database migration destroys settings or prevents downgrade | Future persistence consolidates many stores | Backup, transactional/idempotent migration, corrupt-input tests, export and rollback drill |

## Initial security invariants

- Remote access is off or deny-by-default until the caller is authenticated and the route is explicitly allowlisted.
- Authentication and user confirmation are separate checks.
- Approval is one-time, short-lived, and bound to actor, capability, normalized arguments, and a current target fingerprint.
- AI output and external content can propose work but cannot grant capabilities or execute an adapter directly.
- The renderer never owns authoritative secrets or durable security policy.
- Jarvis Core is the only future SQLite writer; the AI engine and renderer receive narrow APIs.
- Secrets do not appear in URLs, renderer storage, logs, error bodies, fixtures, or audit payloads.
- File paths, URLs, process arguments, request bodies, audio, and screenshots have explicit schemes, roots, types, and size/time limits.
- Remote commands have protocol versions, command IDs, idempotency keys, deadlines, acknowledgements, revocation, and audit metadata.
- Compatibility paths remain feature-flagged until parity is tested; migrations are not destructive until recovery is demonstrated.

## Phase exits affected by this model

- R02/R03: restore the trusted build chain and add negative route/redaction fixtures.
- R04/R05: make runtime schemas, stable errors, identities, risk classes, and approval binding executable contracts.
- R06/R07: prevent renderer-owned tool and voice code from bypassing Core policy.
- R10/R11: prove single-writer migrations, OS-vault ownership, restart, export, and recovery.
- R12: close TM-01 through TM-03 with separate loopback and LAN gateways.
- R13-R15: enforce token/protocol boundaries for AI, Chrome, and Companion clients.

No P0 route should gain new behavior or wider exposure before its actor, capability, authentication, confirmation, redaction, timeout, and audit requirements have tests.
