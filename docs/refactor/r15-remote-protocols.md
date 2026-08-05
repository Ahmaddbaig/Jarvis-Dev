# R15 — unified Chrome and Companion contracts

## Shared protocol

Chrome and Companion now share remote protocol 2 concepts and conformance fixtures: component/build identity, capability advertisement, command ID, idempotency key, deadline, target fingerprint, result replay, acknowledgement, and revocation. The runtime schemas live in `@jarvis/contracts`; byte-identical packaged descriptors are validated for both remote clients.

Pairing rejects protocol or capability mismatches. Chrome status and Companion status expose non-secret version/capability diagnostics. Existing legacy pairings remain readable but incompatible until the updated client is explicitly re-paired.

## Chrome delivery semantics

Chrome commands use the shared strict command schema. Core redelivers unacknowledged commands; the Manifest V3 service worker caches executed results by idempotency key in session storage and returns the cached result rather than repeating a side effect. Results remain deliverable until Core acknowledges them, and mismatched key reuse is rejected. Existing per-origin optional permissions, metadata/form masking, current-page confirmation fingerprint, pause, and revoke behavior remain intact.

Release validation checks Manifest V3, service-worker resources, optional origin permissions, semantic extension version, and the packaged protocol descriptor.

## Companion delivery and packaging

Companion is now the `apps/companion` npm workspace and uses the root lockfile/dependency installation. Its macOS, Windows, and Linux package targets are explicit. The server validates protocol/build/capability identity before pairing and retains certificate pinning, bearer auth, exclusive short leases, local pause/emergency stop, constrained input actions, allowlisted application launching, and self-revocation.

Consequential input and application-launch results are stored in a private bounded ledger until acknowledgement. A lost response can be retried with the same key and returns the recorded result; the same key with a different request is rejected. Lease phases use the same retry discipline without persisting lease tokens. Synthetic tests prove native Companion boot, TLS identity, incompatible-protocol rejection, replay, mismatch rejection, restart persistence, and acknowledgement cleanup.

Deskflow remains optional/external and no GPL source was copied into Jarvis.
