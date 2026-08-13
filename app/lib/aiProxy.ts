import { getOpenAiApiKey } from '@/backend/localvoice/config';

/**
 * Compatibility shim for routes ported from upstream JarvisV5.
 *
 * Upstream routes reach paid AI services through the author's signed-in
 * account server ("metered proxy"). This fork keeps the user's own keys in
 * the OS vault instead, so the same interface simply resolves to the real
 * OpenAI API with the locally stored key — nothing leaves the machine except
 * the OpenAI call itself, and no third-party account is involved.
 */

export interface AiProxy {
  /** Base URL for an OpenAI-compatible client. */
  baseURL: string;
  /** The user's own OpenAI API key from the OS vault. */
  apiKey: string;
}

export function getAiProxy(): AiProxy | null {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;
  return { baseURL: 'https://api.openai.com/v1', apiKey };
}

export const AI_UNAVAILABLE =
  'No OpenAI API key is configured. Add one in Settings → Voice to use this feature.';

/**
 * The proxy, or a ready-made error response. Handlers return the response
 * as-is so every one of them fails the same way when the key is missing.
 */
export function requireAiProxy():
  | { ok: true; proxy: AiProxy }
  | { ok: false; status: number; error: string } {
  const proxy = getAiProxy();
  if (!proxy) return { ok: false, status: 503, error: AI_UNAVAILABLE };
  return { ok: true, proxy };
}

/**
 * Upstream routed ElevenLabs text-to-speech through its account server; this
 * fork has no equivalent endpoint, so ElevenLabs TTS reports unavailable and
 * callers fall back to the OpenAI provider.
 */
export function speechEndpoint(): string | null {
  return null;
}
