# R09 renderer server-state ownership

Status: implemented and locally verified on 2026-08-05.

## Query boundary

TanStack Query now owns renderer-side server state. `JarvisQueryProvider` creates one client for the desktop renderer, `frontend/lib/query/keys.ts` defines the shared key hierarchy, and `frontend/lib/query/fetchJson.ts` provides abortable JSON requests with normalized API errors.

The default policy treats data as fresh for 30 seconds, retains inactive cache entries for five minutes, and retries network, 408, 429, and 5xx failures at most twice with bounded backoff. Mutations do not retry automatically. Individual domains override polling and retention where the user experience requires it; companion previews, for example, poll once per second while displayed and are discarded quickly.

## Owned domains

- Settings, diagnostics, voice-model/profile health, and dynamic integration status.
- Weather, geocoding, routes, news, stock quotes, calendar events, and Google service status.
- Home Assistant entities, printer state and telemetry, music playback, companion status/previews, and Chrome extension status.
- Model lifecycle and audit-history keys are reserved centrally for the R14 and R10 endpoints that will make those domains available.

Multiple components now share each authoritative cache instead of maintaining independent effects and polling loops. Query keys exclude secrets: Home Assistant identity is keyed by base URL, and completing its credential wizard evicts the prior cache before loading with the new token.

## Mutations and cancellation

Chrome pairing/revocation, companion pairing/removal, calendar creation, Home Assistant services, printer commands, music commands, and settings saves use mutations with targeted invalidation or optimistic updates. Home Assistant service calls roll back their entity snapshot on failure. Long-lived and user-driven requests receive TanStack Query's `AbortSignal`; companion previews and dynamic integration discovery therefore stop when no consumer remains.

React state remains responsible for transient modal fields, drag state, animation, clocks, microphone frames, audio visualization, and other high-frequency UI state. Those values are deliberately outside the query cache.

## Compatibility boundary

The server settings loader still backfills legacy `localStorage` values so this phase preserves existing installations. It is not a second authoritative server-state store: successful reads update the compatibility cache, while query data drives the renderer. R10 moves non-secret persistence to SQLite and R11 moves secret material to the operating-system vault, after which the compatibility backfill can be retired.

Local evidence: 17 test files and 128 tests pass. Query convention tests cover centralized defaults and secret-free keys; fetch tests cover abort propagation, normalized structured errors, and non-JSON failures. TypeScript, the tightened 63-warning lint ratchet, all 48 inventoried routes, and the production Next.js build remain green.
