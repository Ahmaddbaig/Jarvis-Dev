# R17 - Capability policy cutover

Until this slice the policy layer was defined but unreachable: `@jarvis/core`
had one production consumer, `compatibility.ts`, and it imported tool metadata
only. Every tool call went straight to `fn.handler()`. This slice makes the
dispatcher the execution path for the whole static catalog.

## Where enforcement happens

In the renderer. Most static tool handlers *drive* the renderer — navigation,
HUD, playback, window mode — so there is no server-side seam to put in front
of them without a round trip per call.

That is coherent for the threat being addressed. The principal under
constraint is the model, not the renderer: a tool call arrives as text the
model produced, possibly shaped by content it read (search results, page
contents, LAN-supplied data). The renderer is the user's own foreground
window and is trusted to the same degree the user is.

`@jarvis/core` was made runtime-agnostic to allow this. It previously imported
`node:crypto`; `policy/crypto.ts` now uses Web Crypto, which is why approval
binding hashes and `evaluate()` are async — a browser has no synchronous
SHA-256. `eslint.config.mjs` keeps persistence and secrets out of client
bundles.

## Two vocabularies

Settings track 31 *operations*; policy gates 21 coarser *abilities*, and six
operations share `interface`. `abilitiesForOperations()` derives the ability
set from whatever the user has enabled. Both gates apply: the caller resolves
a tool against the enabled operation set, and policy then checks the ability.
Enabling one `interface` tool does not make the other five reachable.

## Grants

Toggling a tool in Settings is the explicit desktop-user gesture that
authorizes it, so `syncEnabledOperations()` issues one scoped capability grant
per enabled operation. Grants are rebuilt wholesale on every change, so
disabling a tool revokes it immediately rather than leaving a stale grant.

Grants are not persisted to the `capability_grants` table: they are derived
state, and the settings they derive from are already durable. The table
remains for grants that are not settings-shaped (time-boxed, target-scoped).

## Confirmation

`confirmationRequiredFor()` is a pure predicate so the caller can raise the
prompt *before* dispatching. Evaluating twice — once to discover confirmation
is needed, once to run — would double-count the audit trail and consume the
approval on the first pass.

`ToolConfirmationModal` shows the operation, its risk, and the exact arguments.
Escape declines; there is no Enter-to-approve, because approving is the
consequential direction.

**This changes UX.** Ten operations are `confirmation: always`, and five more
are `when-model`, which in a voice assistant means every call, since every call
originates with the model:

| Prompt on every call | Prompt when the model asks |
| --- | --- |
| `computer_use`, `run_shell_command`, `companion_control`, `deskflow_control`, `chrome_control`, `image_generation`, `3d_printing`, `calendar_command`, `home_assistant_command`, `printer_command` | `get_location`, `xray`, `take_photo`, `open_url`, `open_pdf` |

That is what the capability catalog declares the product should do. If a given
tool should be quieter, change its `confirmation` in the owning
`packages/core/src/tools/domains/*.ts` file — the mechanism now exists, so
that is a one-line change per tool rather than a design question.

## Fallback

MCP and skill tools have no server-owned policy definition, so
`ToolRuntime.invoke()` returns `null` for them and the caller runs the legacy
handler. They are still constrained by the enabled-operation filter. Bringing
them under policy needs a way to declare capability metadata for dynamically
discovered tools, which is not in this slice.

## Coverage

`tests/toolRuntime.test.ts` asserts the properties that matter: a disabled tool
does not execute even when named directly, a declined confirmation never
reaches the handler, a LAN client cannot invoke `local-privileged` operations,
arguments are schema-validated before the handler sees them, and revocation
takes effect immediately.
