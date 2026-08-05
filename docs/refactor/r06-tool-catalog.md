# R06 static tool catalog bridge

Status: first behavior-preserving R06 slice implemented and locally verified on 2026-08-05.

The 31 built-in model tools now have immutable, Core-owned policy definitions. Each definition assigns a stable operation ID, capability, risk class, ability, and confirmation mode. The frontend registry attaches those definitions through a strict compatibility bridge while retaining its existing descriptions, model schemas, handlers, ordering, and call sites.

## Boundary established

- `packages/core/src/tools/static-catalog.ts` is the authoritative static policy catalog.
- `frontend/lib/tools/types.ts` owns the compatibility types formerly embedded in the 2,000-line registry.
- `frontend/lib/tools/compatibility.ts` rejects duplicate tool names, model-name mismatches, missing policies, and orphan policies at module initialization.
- Every catalog entry is runtime-validated by the shared contract schema when Core constructs a `CapabilityCatalog`.
- Privileged, externally effectful, and remote-control operations cannot declare `confirmation: never` in the characterization test.
- Dynamic MCP and skill tools remain compatible through an optional policy field; they must receive server-owned definitions before they can move to Core execution.

## Deliberate compatibility limit

This slice does not enforce the new policy or move handlers out of the renderer. Doing that before operation-specific argument schemas and parity tests exist would change behavior and create a second, uncharacterized execution path. The attached metadata is therefore descriptive until the later R06 slices add runtime argument schemas, stable result envelopes, and a Core dispatcher.

Mixed-action legacy tools such as `calendar_command`, `home_assistant_command`, `printer_command`, and `chrome_control` are conservatively classified at their highest current risk. They should be split into action-specific operations before enforcement so read-only actions are not overprivileged and write actions cannot inherit a read policy.

Local evidence: 6 test files and 74 tests pass. The static registry and policy catalog contain the same 31 unique operations; compatibility failures and confirmation invariants are covered by tests. TypeScript, the lint ratchet, all 48 inventoried routes, and the production Next.js browser build are green.
