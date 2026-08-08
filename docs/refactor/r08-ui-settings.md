# R08 UI and settings decomposition

Status: implemented and locally verified on 2026-08-05.

## Settings boundary

- `packages/contracts/src/settings.ts` is now the source of truth for the versioned Jarvis settings document and patch schema.
- The contract derives all settings TypeScript types, including voice engine, LocalAI profile, realtime model, theme, grid, visualizer, logo, and position.
- Runtime bounds cover credentials, prompts, identifiers, paths, function lists, and playback rate; unknown fields and duplicate functions fail closed.
- LocalAI endpoints are limited to loopback HTTP(S), preventing settings from turning the local model client into an arbitrary outbound/metadata request.
- Version 1 is added when a complete legacy document has no version, while explicit unsupported versions are rejected.
- `JarvisAssistant` runtime-validates both server and local compatibility sources before selection and validates the merged document before use.
- `SettingsModal` consumes the shared derived type and no longer owns a handwritten schema.
- `SettingsModal` is now a 135-line navigation/save shell, reduced from the 1,394-line baseline without changing the tab order, labels, controls, or layout.

## Component boundaries

- `JarvisSettingsSection` owns voice-engine configuration, provider health checks, audio-device discovery, visualizer/logo/position controls, and the initial prompt.
- `AbilitiesSettingsSection` owns the built-in capability registry and delegates dynamic MCP/skill rows to `IntegrationsSettingsSection`.
- `InterfaceSettingsSection` owns theme and background-grid preferences.
- `ComputersSettingsSection` owns companion discovery, pairing, removal, status refresh, and live-display launch.
- `SystemSettingsSection` owns macOS permissions, executable overrides, and diagnostics.
- `ChromeSettingsSection` owns extension status, pairing-code generation, revocation, and extension-path presentation.
- Shared `AbilityRow` presentation keeps built-in and integration toggles consistent without coupling their data sources.

Secrets remain fields in this compatibility schema until R11 moves their values behind vault references. The decomposition deliberately moved existing behavior without redesigning the settings experience.

Local evidence: 15 test files and 122 tests pass. Settings tests cover current and legacy versions, strict patches, bounds, unknown fields, loopback enforcement, duplicates, and list limits. TypeScript, the unchanged 67-warning lint ratchet, all 48 inventoried routes, and the production Next.js build remain required gates.
