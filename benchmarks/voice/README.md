# Voice baseline benchmark

R01 defines the measurement format; it does not commit personal recordings or pretend to capture hardware results that were not run.

Record JSON Lines with one event per line. Every turn shares `runId`, `profile`, `provider`, and `scenario` and uses a monotonic millisecond clock for `timestampMs`.

Required event vocabulary:

1. `speech_end`
2. `final_transcript`
3. `first_model_token`
4. `first_tool_proposal` when the scenario calls a tool
5. `tool_result` when the scenario calls a tool
6. `first_audio`
7. `response_complete`

Generate a synthetic format example:

```bash
npm run refactor:voice-benchmark -- --template
```

Summarize captured events:

```bash
npm run refactor:voice-benchmark -- benchmarks/voice/local-m3.jsonl
```

Add `--json` for machine-readable output. The harness calculates transcript, first-token, tool-proposal, tool-execution, first-audio, and response-complete latency with p50/p95/min/max summaries.

## Fixed scenario corpus

Run at least ten warm turns per scenario and profile after one discarded warm-up turn:

| Scenario | Example intent | Required observations |
| --- | --- | --- |
| `short_answer` | Ask for the current date | Speech end through first audio and completion |
| `safe_tool` | Ask for weather in a fixed synthetic location | Tool proposal/result and spoken response |
| `long_answer` | Ask for a three-part offline explanation | First token/audio, completion, peak memory |
| `interrupt` | Interrupt speech after first audio | Audio-stop acknowledgement and stale-output absence |
| `recovery` | Restart or disconnect the provider once | Reconnect time, duplicate-loop absence, final success |

For every cohort, also record application SHA, packaged/dev mode, OS and architecture, selected profile/model IDs, cold/warm state, process RSS, CPU, swap, and GPU/VRAM where available. Keep raw audio off by default and never commit real voices, credentials, calendar data, screenshots, or device names.

Compare later phases on the same machine and profile. A local-voice change fails the initial budget if p50 regresses by more than 10% or p95 by more than 20% against the tagged baseline.
