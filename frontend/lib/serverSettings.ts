import { jarvisSettingsPatchSchema, NON_SECRET_SERVER_SETTING_KEYS, type CredentialStatus } from '@jarvis/contracts';

/**
 * Shared helper for reading / writing server-side settings.
 *
 * Non-sensitive settings are stored by the server. Credential values never
 * cross this boundary; callers receive configured/not-configured flags only.
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

  // Weather
  jarvis_weather_location?: string;
  jarvis_weather_lat?: string;
  jarvis_weather_lon?: string;

  // Bambu Lab
  bambu_email?: string;
  bambu_token_exp?: string;

  // News
  jarvis_news_settings?: string;   // JSON-serialised NewsSettings object

  // Voicebox voice engine
  jarvis_voicebox_url?: string;    // default http://127.0.0.1:17493

  // Calendar onboarding
  jarvis_gcal_wizard_skipped?: string;

  credentialStatus?: CredentialStatus;
};

// ── In-memory cache so widgets can read settings synchronously after boot ──
let _cache: ServerSettings = {};
let _loaded = false;

type StringSettingKey = Exclude<keyof ServerSettings, 'credentialStatus'>;

const LEGACY_NON_SECRET_KEYS: readonly StringSettingKey[] = NON_SECRET_SERVER_SETTING_KEYS;

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

export function getCachedSetting(key: StringSettingKey): string {
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
  }
  _cache = data;
  _loaded = true;
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
  key: StringSettingKey,
  localStorageKey?: string,
): string {
  const fromServer = serverSettings[key];
  if (fromServer) return fromServer;
  if (typeof window !== 'undefined') {
    return localStorage.getItem(localStorageKey ?? key) ?? '';
  }
  return '';
}
