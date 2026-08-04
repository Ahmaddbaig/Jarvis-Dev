# Jarvis V5 — AI Desktop Assistant

Electron + Next.js desktop assistant with voice, HUD widgets, and smart-home integrations.

## Running in development

Double-click `RUN-JARVIS-DEV.command`, or:

```bash
npm run dev:desktop
```

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
