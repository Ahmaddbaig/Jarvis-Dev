# R12 — Internal and LAN gateway hardening

R12 replaces the former anonymous TLS reverse proxy with two explicit trust boundaries:

- The Next.js/Core server binds only to `127.0.0.1`. A root-level Next.js 16 `proxy.ts` rejects non-loopback API traffic, rejects mixed-origin browser requests, requires a same-loopback origin for ordinary mutations, accepts the desktop bearer trust channel, and sanitizes all gateway identity headers before route handlers run.
- Electron is the only listener on `0.0.0.0`. Its HTTPS gateway serves application pages only to paired browsers and forwards only the exact API method/path pairs in `apps/desktop/src/lan-gateway-policy.ts`. There is no fallback that proxies an unknown `/api/*` route.

Next.js 16 renamed Middleware to Proxy and runs the convention from the project root; Jarvis follows the current [official Proxy convention](https://nextjs.org/docs/app/getting-started/proxy). Proxy performs only the fast trust-boundary check. Durable session verification remains in the Node route/service layer, matching the official guidance that Proxy is not a full session store.

## Pairing and identity

The desktop System settings page shows the LAN pairing URL and creates a six-digit, single-use code valid for ten minutes. The user selects any combination of `read`, `control`, `ai`, and `settings` scopes. A successful exchange creates:

- a `lan-client` device record in SQLite;
- a pairing record containing scopes, a user-agent hash, last-seen time, and only a SHA-256 session-token hash;
- a raw 256-bit opaque token sent once to a `Secure`, `HttpOnly`, `SameSite=Strict`, host-only browser cookie.

The raw token is never logged, stored in SQLite, returned to the renderer, placed in a URL, or forwarded to the internal server. Revocation changes the pairing state immediately, so the next request fails and clears the browser cookie.

## CSRF, allowlist, throttling, and audit

Every cookie-authenticated state change must have an exact HTTPS `Origin` matching the gateway `Host`; Fetch Metadata must also be same-origin when the browser supplies it. Electron marks the already-verified request over its private trust channel; the Next boundary rejects a mutation if that CSRF mark is absent. The internal boundary also rejects reads explicitly marked cross-site.

The executable LAN allowlist assigns one scope and a consequential flag to each permitted method/path pair. Shell execution, arbitrary skills/MCP execution or registration, credentials, process lifecycle, local diagnostics, URL opening, Chrome control, companion control, computer use, Deskflow, storage administration, and every unknown future route remain internal or desktop-only by default.

Pairing is limited to five attempts per remote address in five minutes. Consequential commands are limited to thirty per paired token per minute. Pairing issuance, pairing success/failure, scope denial, throttling, consequential authorization, and revocation append structured records to the `security_audit` SQLite table. Repeated identical denials are audit-throttled and the newest 10,000 records are retained. Remote addresses and user agents are represented only by hashes.

## Validation and abuse coverage

Automated tests prove that:

- the executable allowlist and audited route inventory are identical;
- dangerous/internal route families cannot be selected by the LAN policy;
- cross-origin and origin-less browser mutations fail closed;
- trusted gateway mutations require the CSRF verification mark;
- Chrome extension origins remain confined to their protocol routes;
- one-time codes produce only token hashes in SQLite;
- scope denial, rate limiting, security audit, and immediate revocation work across the persistent session boundary.

## Rollback

Rollback is code-only. Schema v2 adds `security_audit`; older binaries must not open a newer schema and therefore remain downgrade-blocked by the R10 version guard. Before rolling back, create a recovery export, install a compatible R12-or-newer build, or explicitly migrate a copy of the database. Revoking every LAN client before rollback invalidates all browser sessions without exposing or recovering raw tokens.
