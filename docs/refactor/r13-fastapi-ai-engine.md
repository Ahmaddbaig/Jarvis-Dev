# R13 — supervised FastAPI AI engine

## Outcome

Electron now owns a persistent, authenticated FastAPI sidecar. It reserves an ephemeral loopback port, creates a 256-bit per-launch bearer token, sends startup configuration over stdin instead of argv or inherited provider environment, verifies protocol and build identity before opening the main window, and writes a mode-`0600` session descriptor solely for the Next/Core process. Graceful desktop shutdown terminates the sidecar and removes that descriptor.

The supervisor performs bounded retries at 0.5, 2, and 5 seconds. A failed service leaves Jarvis usable in a clearly unavailable diagnostic state; it does not expose credentials to the renderer. Core re-validates descriptor schema, owner, permissions, PID, host, and protocol on every request.

## Service contract

`services/ai-engine/jarvis_ai_engine` exposes authenticated `/v1/health`, `/v1/capabilities`, `/v1/models`, `/v1/jobs/{id}`, `/v1/respond`, `/v1/transcribe`, `/v1/speak`, and `/v1/vision` contracts. The service reports protocol, build SHA, Python/runtime/package versions, hardware memory, provider readiness, and whether the runtime is frozen. Tool output is proposal-only; the Python process never executes Jarvis tools or writes Core SQLite.

Resource startup and shutdown use the current FastAPI lifespan contract. OpenAI remains optional and no provider key is required to boot. Low-latency transcription and speech deliberately return a migration-state response instead of rerouting realtime media through Python before benchmark parity exists.

## Packaging and verification

Dependencies are pinned for Python 3.12. `npm run build:ai` creates a PyInstaller one-directory native artifact on the current OS; Electron packages that directory as an external resource. CI builds the artifact independently on macOS arm64, Windows x64, and Linux x64.

Verification at this checkpoint:

- the real Electron supervisor launched the Python module, authenticated health, passed Core routing, and wiped its session on stop;
- unauthenticated health was rejected;
- protocol/build mismatch and absent-profile behavior are covered;
- the one-directory macOS arm64 artifact built successfully;
- no LocalAI model process or profile is loaded during module import or AI-engine boot.

Implementation guidance follows the official [FastAPI lifespan documentation](https://fastapi.tiangolo.com/advanced/events/) and [PyInstaller operating mode documentation](https://pyinstaller.org/en/stable/operating-mode.html).
