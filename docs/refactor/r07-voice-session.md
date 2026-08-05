# R07 voice-session extraction

Status: provider-neutral lifecycle slice implemented and locally verified on 2026-08-05.

`JarvisAssistant` previously updated session status, error, and microphone state independently from its OpenAI/LocalAI WebRTC path, ElevenLabs callbacks, and Voicebox hook. Those providers now report through one `useVoiceSessionState` boundary backed by a pure reducer.

## Boundary established

- `frontend/lib/voiceSession/state.ts` owns the four existing UI states (`idle`, `listening`, `active`, and `error`), the last provider error, and microphone mute state.
- Named events cover start, connect, disconnect, failure, and microphone changes without importing React, browser APIs, or any provider SDK.
- `frontend/lib/voiceSession/useVoiceSessionState.ts` is the React adapter used by the existing assistant component.
- `frontend/lib/voiceSession/adapter.ts` defines the provider-neutral adapter and observer contracts for the later OpenAI/LocalAI, ElevenLabs, and Voicebox extractions.
- `frontend/lib/voiceSession/realtimeResources.ts` owns idempotent teardown for peer connections, data channels, and local/remote media tracks; provider switching and disconnect now share that path.
- Resource references are cleared before close/stop calls, all resources are attempted even if one release fails, and cleanup errors remain visible to the existing console/error interception path.
- Microphone mute state remains independent from connection lifecycle, matching current compact-mode and desktop-overlay behavior.
- Starting or connecting clears stale visible errors; a provider error without details preserves the last known detail, matching the existing data-channel error path.

## Deliberate compatibility limit

These slices do not yet move transport construction, model events, tool calls, music ducking, or reconnect timers. Existing provider code still runs inside `JarvisAssistant`; lifecycle writes and transport teardown now sit behind shared boundaries. Provider adapters will be extracted incrementally with connection/disconnection and resource-cleanup parity tests.

Local evidence: 9 test files and 93 tests pass. Five reducer characterizations cover lifecycle, error, mute, and no-op transitions; three resource tests cover complete release, repeated cleanup, and partial cleanup failure. TypeScript, the unchanged 67-warning lint ratchet, all 48 inventoried routes, and the production Next.js build remain required gates.
