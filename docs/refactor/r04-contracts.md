# R04 shared contracts

Status: initial package implemented and locally verified on 2026-08-05.

`packages/contracts` is the first npm workspace and is browser-safe by construction. Zod schemas are the runtime source of truth and TypeScript types are inferred from them.

## Initial protocol

Protocol version 1 provides:

- strict component handshakes with independent protocol and component versions;
- opaque request, trace, session, and idempotency identifiers;
- strict actor, operation, target, deadline, and command envelopes;
- strict result envelopes with coherent error, side-effect, replay, and timing state;
- the stable `VALIDATION`, `AUTH`, `POLICY`, `NOT_FOUND`, `CONFLICT`, `TRANSIENT`, `EXECUTION`, and `INTERNAL` error families;
- bounded JSON values: maximum depth, node count, keys, array items, key length, and string length;
- rejection of non-finite/non-JSON data, prototype-related keys, unknown envelope fields, and policy-owned fields supplied through operation arguments.

Only `TRANSIENT` errors may declare automatic retry. `EXECUTION` failures require side-effect reconciliation before a caller considers retrying.

## Adoption boundary

This slice defines and tests the contract without changing current Chrome, Companion, voice, or tool behavior. R05 will add capability/risk/approval policy. Later compatibility adapters can translate existing protocols into these envelopes one boundary at a time, with conformance tests before old message shapes are removed.

Local evidence: 4 test files and 53 tests pass, including command/result invariants and adversarial payload bounds. TypeScript and the lint ratchet remain green.
