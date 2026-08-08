# R07 voice-session extraction

Status: R07 exit criteria implemented and locally verified on 2026-08-05.

`JarvisAssistant` previously updated session status, error, and microphone state independently from its OpenAI/LocalAI WebRTC path, ElevenLabs callbacks, and Voicebox hook. Those providers now report through one `useVoiceSessionState` boundary backed by a pure reducer.

## Boundary established

- `frontend/lib/voiceSession/state.ts` owns the four existing UI states (`idle`, `listening`, `active`, and `error`), the last provider error, and microphone mute state.
- Its domain phase model now distinguishes idle, connecting, listening, thinking, speaking, reconnecting, and failed while projecting the unchanged four-state UI contract.
- Named events cover start, connect, disconnect, failure, and microphone changes without importing React, browser APIs, or any provider SDK.
- `frontend/lib/voiceSession/session-controller.ts` is the single lifecycle owner, exposes immutable snapshots/subscriptions, and suppresses no-op or duplicate transitions.
- `frontend/hooks/useJarvisVoice.ts` is the React binding used by the existing assistant component.
- `frontend/lib/voiceSession/adapter.ts` defines the provider-neutral adapter and observer contracts for the later OpenAI/LocalAI, ElevenLabs, and Voicebox extractions.
- `frontend/lib/voiceSession/realtimeResources.ts` owns idempotent teardown for peer connections, data channels, and local/remote media tracks; provider switching and disconnect now share that path.
- Resource references are cleared before close/stop calls, all resources are attempted even if one release fails, and cleanup errors remain visible to the existing console/error interception path.
- `frontend/lib/voiceSession/instructions.ts` now owns shared speech vocabulary normalization, transcription priming, wake-word gating, browser safety, music routing, and navigation constraints used across providers.
- OpenAI and LocalAI now implement one realtime provider adapter for readiness, signaling, ICE requirements, and session-update translation; the controller injects configuration and credentials rather than either adapter reading browser storage.
- Provider failures expose stable, redacted codes and never include upstream response bodies.
- `frontend/lib/voiceSession/audio-input.ts` owns microphone constraints, selected-device fallback, initial mute application, permission probing, and stream track state.
- The ElevenLabs permission check now stops its temporary tracks immediately; the SDK remains the sole owner of session audio.
- `frontend/hooks/useVisualizerAudio.ts` now owns realtime analyser setup, provider-volume polling, animation-frame cleanup, level normalization, and the existing 64-bar FFT projection without provider or tool logic in the component.
- Microphone mute state remains independent from connection lifecycle, matching current compact-mode and desktop-overlay behavior.
- Starting or connecting clears stale visible errors; a provider error without details preserves the last known detail, matching the existing data-channel error path.

## Deliberate compatibility limit

WebRTC construction, the realtime event loop, tool calls, and music ducking remain compatibility code in `JarvisAssistant`. They will move with the Core tool gateway and UI decomposition rather than combining a behavior move with this lifecycle/provider change. R07's explicit acceptance gates are met: provider switching uses one adapter contract, all seven lifecycle phases and interruption/reconnect sequences are deterministic, microphone/model failures do not create reconnect loops, and voice modules never read API keys from local storage.

Local evidence: 14 test files and 117 tests pass. Controller and reducer characterizations cover all seven phases, subscriptions, atomic reset, stale callbacks, repeated failure, mute, interruption, reconnect, and no-op transitions. Provider tests cover both signaling formats, shared configuration, credential injection, readiness, missing models, malformed SDP, and response-body redaction. Microphone, resource, visualizer, and instruction suites retain their lifecycle and safety coverage. TypeScript, the unchanged 67-warning lint ratchet, all 48 inventoried routes, and the production Next.js build remain required gates.
