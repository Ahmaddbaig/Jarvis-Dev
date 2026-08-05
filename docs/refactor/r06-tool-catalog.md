# R06 static tool catalog bridge

Status: declarative catalog and runtime-schema slices implemented and locally verified on 2026-08-05.

The 31 built-in model tools now have immutable, Core-owned policy definitions. Each definition assigns a stable operation ID, capability, risk class, ability, and confirmation mode. The frontend registry attaches those definitions through a strict compatibility bridge while retaining its existing descriptions, model schemas, handlers, ordering, and call sites.

## Boundary established

- `packages/core/src/tools/static-catalog.ts` is the authoritative static policy catalog.
- Seven domain modules now separate information, computer, media, smart-environment, system, browser, and presentation tools.
- Every static operation has a unique normalized server handler ID and a strict Zod input schema.
- `frontend/lib/tools/types.ts` owns the compatibility types formerly embedded in the 2,000-line registry.
- `frontend/lib/tools/compatibility.ts` rejects duplicate tool names, model-name mismatches, missing policies, and orphan policies at module initialization.
- Every catalog entry is runtime-validated by the shared contract schema when Core constructs a `CapabilityCatalog`.
- Structural parity tests compare every runtime input schema with its existing model-visible JSON schema, including required fields, property types, arrays, and enums.
- Privileged, externally effectful, and remote-control operations cannot declare `confirmation: never` in the characterization test.
- Dynamic MCP and skill tools remain compatible through an optional policy field; they must receive server-owned definitions before they can move to Core execution.

## Deliberate compatibility limit

These slices do not enforce the new policy or move handlers out of the renderer. The attached metadata and schemas remain descriptive until a Core dispatcher and stable result envelopes replace the current direct callback path behind characterization tests.

Mixed-action legacy tools such as `calendar_command`, `home_assistant_command`, `printer_command`, and `chrome_control` are conservatively classified at their highest current risk. They should be split into action-specific operations before enforcement so read-only actions are not overprivileged and write actions cannot inherit a read policy.

Local evidence: 6 test files and 77 tests pass. The static registry and policy catalog contain the same 31 unique operations; compatibility failures, schema parity, strict parsing, handler identity, and confirmation invariants are covered by tests. TypeScript, the lint ratchet, all 48 inventoried routes, and the production Next.js browser build are green.
