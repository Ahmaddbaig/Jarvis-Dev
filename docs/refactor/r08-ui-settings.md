# R08 UI and settings decomposition

Status: shared settings-contract slice implemented and locally verified on 2026-08-05; component decomposition remains in progress.

## Settings boundary

- `packages/contracts/src/settings.ts` is now the source of truth for the versioned Jarvis settings document and patch schema.
- The contract derives all settings TypeScript types, including voice engine, LocalAI profile, realtime model, theme, grid, visualizer, logo, and position.
- Runtime bounds cover credentials, prompts, identifiers, paths, function lists, and playback rate; unknown fields and duplicate functions fail closed.
- LocalAI endpoints are limited to loopback HTTP(S), preventing settings from turning the local model client into an arbitrary outbound/metadata request.
- Version 1 is added when a complete legacy document has no version, while explicit unsupported versions are rejected.
- `JarvisAssistant` runtime-validates both server and local compatibility sources before selection and validates the merged document before use.
- `SettingsModal` consumes the shared derived type and no longer owns a handwritten schema.

Secrets remain fields in this compatibility schema until R11 moves their values behind vault references. R08 will next split the 1,300-line modal into Jarvis, Abilities, Interface, System, Computers, Chrome, and Integrations sections without changing layout or controls.

Local evidence: 15 test files and 122 tests pass. Settings tests cover current and legacy versions, strict patches, bounds, unknown fields, loopback enforcement, duplicates, and list limits. TypeScript, the unchanged 67-warning lint ratchet, all 48 inventoried routes, and the production Next.js build remain required gates.
