import { jarvisSettingsPatchSchema } from '@jarvis/contracts';

/**
 * Shared helper for reading / writing server-side settings.
 *
 * All sensitive keys (OpenAI, ElevenLabs, HA token, etc.) live in a JSON
 * file on the *server* machine so every client that connects — including
 * tablets and phones on the LAN — inherits them automatically.
 *
 * Usage:
 *   const settings = await loadServerSettings();
 *   await saveServerSettings({ jarvis_ha_url: 'http://...' });
 *
 * For synchronous reads (widget helpers etc.), use `getCachedSetting(key)`.
 * The cache is populated on first `loadServerSettings()` call.
 */

export type ServerSettings = {
  // Jarvis core
  jarvis_settings?: string;        // JSON-serialised JarvisSettings object

  // Home Assistant
  jarvis_ha_url?: string;
  jarvis_ha_token?: string;

  // Weather
  jarvis_weather_location?: string;
  jarvis_weather_lat?: string;
  jarvis_weather_lon?: string;

  // iCal / Calendar
  jarvis_ical_url?: string;

  // Bambu Lab
  bambu_email?: string;
  bambu_token_exp?: string;

  // News
  jarvis_news_settings?: string;   // JSON-serialised NewsSettings object

  // Voicebox voice engine
  jarvis_voicebox_url?: string;    // default http://127.0.0.1:17493
};

// ── In-memory cache so widgets can read settings synchronously after boot ──
let _cache: ServerSettings = {};
let _loaded = false;

const LEGACY_NON_SECRET_KEYS: readonly (keyof ServerSettings)[] = [
  'jarvis_ha_url',
  'jarvis_weather_location',
  'jarvis_weather_lat',
  'jarvis_weather_lon',
  'bambu_email',
  'bambu_token_exp',
  'jarvis_news_settings',
  'jarvis_voicebox_url',
];

function localNonSecretImport(serverSettings: ServerSettings): Partial<ServerSettings> {
  if (typeof window === 'undefined') return {};
  const patch: Partial<ServerSettings> = {};
  for (const key of LEGACY_NON_SECRET_KEYS) {
    const value = localStorage.getItem(key);
    if (!serverSettings[key] && value) patch[key] = value;
  }
  if (!serverSettings.jarvis_settings) {
    try {
      const parsed = JSON.parse(localStorage.getItem('jarvis_settings') ?? '') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const safe = { ...(parsed as Record<string, unknown>) };
        delete safe.apiKey;
        delete safe.claudeApiKey;
        const validated = jarvisSettingsPatchSchema.safeParse(safe);
        if (validated.success) patch.jarvis_settings = JSON.stringify(validated.data);
      }
    } catch { /* no valid local settings to import */ }
  }
  return patch;
}

export function getCachedSetting(key: keyof ServerSettings): string {
  const fromCache = _cache[key];
  if (fromCache) return fromCache;
  // Fall back to localStorage (host machine backwards-compat)
  if (typeof window !== 'undefined') {
    return localStorage.getItem(key) ?? '';
  }
  return '';
}

export async function fetchServerSettings(signal?: AbortSignal): Promise<ServerSettings> {
  const response = await fetch('/api/settings', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Settings returned HTTP ${response.status}.`);
  let data = (await response.json()) as ServerSettings;
  const localImport = localNonSecretImport(data);
  if (Object.keys(localImport).length > 0) {
    const importResponse = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localImport),
      signal,
    });
    if (!importResponse.ok) throw new Error(`Legacy settings import returned HTTP ${importResponse.status}.`);
    data = { ...data, ...localImport };
    localStorage.setItem('jarvis_settings_migrated_v1', 'true');
  }
  _cache = data;
  _loaded = true;
  // Back-fill localStorage so the host machine benefits from server settings too
  if (typeof window !== 'undefined') {
    const syncKeys: (keyof ServerSettings)[] = [
      'jarvis_ha_url', 'jarvis_ha_token',
      'jarvis_weather_location', 'jarvis_weather_lat', 'jarvis_weather_lon',
      'jarvis_ical_url', 'bambu_email', 'bambu_token_exp',
    ];
    for (const key of syncKeys) {
      if (data[key] && !localStorage.getItem(key)) {
        localStorage.setItem(key, data[key]);
      }
    }
  }
  return data;
}

export async function loadServerSettings(): Promise<ServerSettings> {
  try {
    return await fetchServerSettings();
  } catch {
    return _cache;
  }
}

export function isServerSettingsLoaded(): boolean { return _loaded; }

export async function persistServerSettings(patch: Partial<ServerSettings>): Promise<void> {
  // Update cache immediately so subsequent getCachedSetting calls see the new value
  _cache = { ..._cache, ...patch };
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Settings save returned HTTP ${response.status}.`);
}

export async function saveServerSettings(patch: Partial<ServerSettings>): Promise<void> {
  try {
    await persistServerSettings(patch);
  } catch (e) {
    console.error('[serverSettings] save failed:', e);
  }
}

/** Read one key — falls back to localStorage for backwards-compat on the host machine. */
export function getLocalOrServer(
  serverSettings: ServerSettings,
  key: keyof ServerSettings,
  localStorageKey?: string,
): string {
  const fromServer = serverSettings[key];
  if (fromServer) return fromServer;
  if (typeof window !== 'undefined') {
    return localStorage.getItem(localStorageKey ?? key) ?? '';
  }
  return '';
}
