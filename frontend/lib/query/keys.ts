export const queryKeys = {
  settings: {
    all: ['settings'] as const,
    current: () => ['settings', 'current'] as const,
  },
  credentials: {
    all: ['credentials'] as const,
    status: () => ['credentials', 'status'] as const,
  },
  diagnostics: {
    all: ['diagnostics'] as const,
    system: () => ['diagnostics', 'system'] as const,
    storage: () => ['diagnostics', 'storage'] as const,
  },
  weather: {
    all: ['weather'] as const,
    location: (latitude: number, longitude: number) => ['weather', 'location', latitude, longitude] as const,
  },
  geocode: {
    all: ['geocode'] as const,
    search: (query: string, limit: number) => ['geocode', 'search', query.trim().toLowerCase(), limit] as const,
  },
  routes: {
    all: ['routes'] as const,
    driving: (start: readonly [number, number], end: readonly [number, number]) => [
      'routes',
      'driving',
      start,
      end,
    ] as const,
  },
  news: {
    all: ['news'] as const,
    headlines: () => ['news', 'headlines'] as const,
  },
  stocks: {
    all: ['stocks'] as const,
    quotes: (symbols: readonly string[]) => ['stocks', 'quotes', [...symbols].sort()] as const,
  },
  calendar: {
    all: ['calendar'] as const,
    events: (timeMin: string, timeMax: string) => ['calendar', 'events', { timeMin, timeMax }] as const,
    integrationStatus: () => ['calendar', 'integration-status'] as const,
    tasks: () => ['calendar', 'tasks'] as const,
  },
  integrations: {
    all: ['integrations'] as const,
    dynamicTools: () => ['integrations', 'dynamic-tools'] as const,
    googleServices: () => ['integrations', 'google-services'] as const,
    googleAuth: (serviceId: string) => ['integrations', 'google-auth', serviceId] as const,
  },
  homeAssistant: {
    all: ['home-assistant'] as const,
    states: (baseUrl: string) => ['home-assistant', 'states', baseUrl] as const,
  },
  printers: {
    all: ['printers'] as const,
    status: () => ['printers', 'status'] as const,
    devices: () => ['printers', 'devices'] as const,
    telemetry: () => ['printers', 'telemetry'] as const,
    tasks: () => ['printers', 'tasks'] as const,
  },
  companions: {
    all: ['companions'] as const,
    list: () => ['companions', 'list'] as const,
    preview: (id: string, screen: number) => ['companions', 'preview', id, screen] as const,
  },
  chrome: {
    all: ['chrome'] as const,
    status: () => ['chrome', 'status'] as const,
  },
  lanGateway: {
    all: ['lan-gateway'] as const,
    state: () => ['lan-gateway', 'state'] as const,
  },
  models: {
    all: ['models'] as const,
    health: (provider: string) => ['models', 'health', provider] as const,
    voiceProfiles: () => ['models', 'voice-profiles'] as const,
    aiEngineHealth: () => ['models', 'ai-engine-health'] as const,
    aiEngineProfiles: () => ['models', 'ai-engine-profiles'] as const,
    aiEngineJob: (id: string | null) => ['models', 'ai-engine-job', id] as const,
  },
  music: {
    all: ['music'] as const,
    nowPlaying: () => ['music', 'now-playing'] as const,
  },
  audit: {
    all: ['audit'] as const,
    history: (cursor?: string) => ['audit', 'history', cursor ?? null] as const,
  },
} as const;
