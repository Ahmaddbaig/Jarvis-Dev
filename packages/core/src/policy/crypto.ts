/**
 * Runtime-agnostic crypto for the policy layer.
 *
 * The dispatcher enforces policy at the point of execution, and most static
 * tool handlers manipulate the renderer (navigation, HUD, playback), so this
 * code runs in the browser as well as in Node. Web Crypto is the only API
 * both provide, which is why binding hashes are async: there is no
 * synchronous SHA-256 in a browser.
 */

function webCrypto(): Crypto {
  const available = globalThis.crypto;
  if (!available?.subtle) {
    throw new Error('Web Crypto is unavailable; the policy layer cannot compute approval bindings.');
  }
  return available;
}

export function randomId(): string {
  return webCrypto().randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await webCrypto().subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
