import { getCoreStore } from '@/backend/persistence/core-store';

/** Server-side configuration for the Voicebox voice engine. */
export const DEFAULT_VOICEBOX_URL = 'http://127.0.0.1:17493';

function readServerSettings(): Record<string, string> {
  try {
    return getCoreStore().readServerSettings();
  } catch {
    return {};
  }
}

export function getVoiceboxUrl(): string {
  const value = readServerSettings().jarvis_voicebox_url;
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_VOICEBOX_URL;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_VOICEBOX_URL;
    return value.trim().replace(/\/+$/, '');
  } catch {
    return DEFAULT_VOICEBOX_URL;
  }
}

function readJarvisSettingsField(field: string): string {
  const raw = readServerSettings().jarvis_settings;
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

export function getOpenAiApiKey(): string {
  return readJarvisSettingsField('apiKey');
}

export function getClaudeApiKey(): string {
  return readJarvisSettingsField('claudeApiKey');
}
