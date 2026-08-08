# R05 capability policy service

Status: framework-independent policy foundation implemented and locally verified on 2026-08-05.

`packages/core` now owns a server-side capability catalog, scoped grant store, target-bound approval service, and policy evaluator. Callers submit a validated operation; the catalog—not caller data—selects its capability, risk class, ability, fingerprint requirement, and confirmation rule.

## Enforced invariants

- Grants and approvals can be issued only from an explicit user gesture, never from model output.
- Grants are scoped to actor and capability, optionally target type/ID, with expiry and immediate revocation.
- Approvals bind actor, session, normalized operation arguments, capability, risk, target identity, and target fingerprint through a SHA-256 digest.
- Approvals expire within two minutes, are removed before validation, and cannot be replayed after success or a binding mismatch.
- Unknown operations and disabled abilities fail closed.
- Public reads require an enabled ability; private reads require a scoped grant; reversible UI changes require visible feedback.
- Local privileged operations require the desktop actor.
- Credential operations require a direct desktop-user gesture and are never model-authorized.
- Remote control requires a current target fingerprint, scoped grant, pairing, active control lease, cleared emergency stop, and one-time approval.
- Untrusted webpage/document/screen observations cannot satisfy confirmation.
- Policy and approval outcomes emit the strict audit-event contract without operation arguments or secrets.

The service is not wired into legacy routes yet, so current behavior remains unchanged. R06 can register tool definitions and route execution through this service behind a compatibility bridge. The old direct path must remain until characterization and parity tests pass.

Local evidence: 5 test files and 68 tests pass, including fabricated/replayed/expired approvals, changed targets and arguments, malformed/expired grants, credential misuse, and remote-control preconditions. TypeScript and the lint ratchet remain green.
