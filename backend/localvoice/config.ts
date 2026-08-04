import fs from 'fs';
import path from 'path';

/**
 * Server-side config for the Voicebox voice engine.
 * Values are read from jarvis-server-settings.json (same file the Settings UI
 * writes via POST /api/settings) with localhost defaults.
 */

export const DEFAULT_VOICEBOX_URL = 'http://127.0.0.1:17493';

function readServerSettings(): Record<string, unknown> {
  try {
    const base = process.env.JARVIS_DATA_DIR || process.cwd();
    const p = path.join(base, 'jarvis-server-settings.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getVoiceboxUrl(): string {
  const value = readServerSettings()['jarvis_voicebox_url'];
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_VOICEBOX_URL;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_VOICEBOX_URL;
    return value.trim().replace(/\/+$/, '');
  } catch {
    return DEFAULT_VOICEBOX_URL;
  }
}

/**
 * OpenAI API key for the Voicebox engine's brain. Read from the serialised
 * jarvis_settings blob so it is the same key the Settings UI stores for the
 * Realtime engine — one key powers both modes.
 */
export function getOpenAiApiKey(): string {
  const raw = readServerSettings()['jarvis_settings'];
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as { apiKey?: unknown };
    return typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
  } catch {
    return '';
  }
}
