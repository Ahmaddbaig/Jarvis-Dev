# R14 — explicit local model lifecycle

## Profile and manifest policy

M2, M3, and M5 remain explicit, separate profiles under `services/ai-engine/profiles`. Each template records a stable manifest ID, minimum/expected memory, expected disk use, capabilities, idle policy, pipeline, LLM, transcription, VAD, and TTS identities. Neither the sidecar nor its UI can select, install, or download a different profile.

The macOS installer now hashes the LocalAI binary, installed-profile marker, selected pipeline/model definitions, and discovered model assets into an atomically written mode-`0600` installation manifest. Existing installations generate that manifest during their first explicit validation/warm job. Every activation re-hashes the selected files and refuses profile substitution or tampering before warmup.

## Non-blocking lifecycle

Validation, warm, and unload operations are cancellable in-memory jobs with bounded progress history. Settings shows the installed profile, engine/server/warm state, manifest metrics, expected resources, current job progress, errors, and cancellation. Model work runs outside the Electron main thread.

The provider starts or attaches to LocalAI on `127.0.0.1`, warms only the installed pipeline, measures load duration and idle time, and terminates only a LocalAI child it owns. M2 unloads after five measured idle minutes and M3 after fifteen; M5 remains warm until an explicit unload. Shutdown cancels jobs and terminates owned processes gracefully.

## Media-path decision

The existing direct LocalAI WebRTC path remains the realtime speech transport. This prevents the architectural migration from silently changing audio latency, word accuracy, memory, or interruption behavior. Moving media through FastAPI remains contingent on the fixed voice benchmark proving no more than the agreed regression budget.

Tests cover atomic manifest creation, repeated validation, tamper detection, profile-substitution refusal, cancellable jobs, no automatic download, authenticated service access, and full supervised process startup/shutdown.
