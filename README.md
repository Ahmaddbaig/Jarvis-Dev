# Jarvis V5 — AI Desktop Assistant

Cross-computer setup is documented in [COMPANION_SETUP.md](COMPANION_SETUP.md). Deskflow keyboard/mouse switching is documented in [DESKFLOW_INTEGRATION.md](DESKFLOW_INTEGRATION.md).

Electron + Next.js desktop assistant with voice, HUD widgets, and smart-home integrations.

## Refactor program

The whole-codebase refactor starts with a behavior-preserving baseline. The current gate status and reproducibility evidence are in [docs/refactor/baseline-2026-08-05.md](docs/refactor/baseline-2026-08-05.md), with the [initial threat model](docs/refactor/threat-model.md), source-validated [API route inventory](docs/refactor/route-inventory.json), [typed Electron build notes](docs/refactor/r02-electron-build.md), and [test/CI foundation](docs/refactor/r03-test-ci.md). Run `npm run check` for the local quality gate, `npm run refactor:baseline` for the full baseline suite, and `npm run refactor:routes -- --check` to detect unclassified route changes.

## Running in development

Double-click `RUN-JARVIS-DEV.command`, or:

```bash
npm run dev:desktop
```

## Voice engines

Four engines are selectable in Settings:

- **OpenAI Realtime** — GPT speech-to-speech over WebRTC (needs OpenAI API key).
- **Local AI** — free on-device LocalAI speech pipeline with profiles tuned for
  M2, M3, and M5 Macs.
- **ElevenLabs** — Conversational AI agent over WebRTC (needs agent id).
- **Voicebox** — the movie JARVIS voice: Silero VAD → whisper.cpp STT →
  API chat brain → Voicebox TTS with a cloned voice profile. The brain
  provider is a dropdown in Settings: OpenAI (same API key as Realtime,
  default `gpt-4o-mini`) or Claude (own Anthropic API key, default
  `claude-haiku-4-5`). Both providers use the same selected Voicebox profile
  for spoken and typed-chat replies. Voicebox playback defaults to a slower, pitch-preserving
  `0.80×` speed and can be adjusted in Settings.

The Voicebox engine expects:

```bash
brew install whisper-cpp
curl -L -o ~/.cache/whisper-cpp/ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
# plus the Voicebox app running on http://127.0.0.1:17493
```

## Map services

The map uses CartoDB tiles, OpenStreetMap Nominatim geocoding, and OSRM routing
without API keys. Geocoding is cached and rate-limited by Jarvis. To use
self-hosted providers, set `JARVIS_NOMINATIM_URL` and `JARVIS_OSRM_URL` before
starting the app.

## Local AI installation

For free on-device voice AI, including the separate M2, M3, and M5 profiles,
see [LOCAL_AI_INSTALL.md](LOCAL_AI_INSTALL.md). Install only the profile matching
the Mac that will run Jarvis. For a complete M2/8 GB walkthrough, see
[localllm.md](localllm.md).

To let Jarvis search, read, and operate user-approved websites in an existing
Google Chrome profile, install the paired local extension described in
[CHROME_USE.md](CHROME_USE.md). Chrome access is disabled until the extension is
paired, the **Chrome Use** ability is enabled, and each website is approved by
the user.

## Project layout

```
├── app/                  # ROUTING (Next.js App Router — folder path = URL, don't move)
│   ├── page.tsx          #   main UI page (/)
│   ├── layout.tsx        #   root layout + global CSS
│   ├── desktop-overlay/  #   /desktop-overlay page
│   └── api/              #   BACKEND ENDPOINTS — one folder per HTTP API
│       ├── settings/     #     reads/writes jarvis-server-settings.json
│       ├── bambu/        #     3D printer (login, status, telemetry, commands)
│       ├── mcp/          #     MCP servers + Google services auth
│       └── ...           #     weather, music, shell, web-search, xray, etc.
│
├── frontend/             # FRONTEND — everything rendered in the browser/Electron window
│   ├── components/       #   React components
│   │   ├── HUD/          #     HUD layer + widgets (clock, map, music, printer…)
│   │   ├── pages/        #     full-page views (calendar, news, music, printer…)
│   │   ├── visualizers/  #     voice visualizers (arc reactor, sphere…)
│   │   └── wizards/      #     setup wizards (Google Calendar, Home Assistant)
│   ├── hooks/            #   React hooks (useIsMobile)
│   ├── lib/              #   client-side helpers (settings client, sfx, function
│   │                     #   definitions for the voice model, error bus)
│   └── assets/           #   images imported by components
│
├── backend/              # BACKEND — server-side logic used by app/api routes
│   ├── bambu/            #   Bambu Lab MQTT connection manager
│   ├── mcp/              #   MCP server manager + Google service runtime
│   ├── skills/           #   user-defined skills loader
│   ├── search/           #   DuckDuckGo search + datasheet ranking
│   └── media/            #   Windows media session helper
│
├── shared/               # types/config used by BOTH frontend and backend
│
├── dist-electron/        # Electron main + preload (compiled)
├── scripts/              # Python computer-use helper + compiled binary
├── public/               # static assets served at /
└── jarvis-server-settings.json   # SETTINGS + API KEYS (gitignored, created by the
                                  # Settings UI via POST /api/settings)
```

### Where settings live

Settings (including API keys) entered in the in-app Settings modal are POSTed to
`/api/settings` and written to `jarvis-server-settings.json` — next to the code in
dev, or in the Electron data dir (`JARVIS_DATA_DIR`) in the packaged app. This file
is gitignored; there is no `.env`.

### Import aliases

`tsconfig.json` maps `@/*` to the repo root, so imports look like
`@/frontend/components/…`, `@/backend/mcp/…`, `@/shared/google-services`.
