import { getCoreStore } from '@/backend/persistence/core-store';
import { getCredentialService } from '@/backend/secrets/credential-service';

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

export function getOpenAiApiKey(): string {
  return getCredentialService().get('openaiApiKey') ?? '';
}

export function getClaudeApiKey(): string {
  return getCredentialService().get('anthropicApiKey') ?? '';
}
