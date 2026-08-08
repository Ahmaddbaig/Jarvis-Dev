'use client';

let chromeControlTokenPromise: Promise<string> | null = null;

async function chromeControlToken(): Promise<string> {
  if (!window.electron?.getChromeControlToken) {
    throw new Error('Chrome control is available only inside the local Jarvis desktop application.');
  }
  if (!chromeControlTokenPromise) {
    chromeControlTokenPromise = window.electron.getChromeControlToken().then((token) => {
      if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
        throw new Error('Jarvis did not provide a valid local Chrome-control authorization token.');
      }
      return token;
    }).catch((error) => {
      chromeControlTokenPromise = null;
      throw error;
    });
  }
  return chromeControlTokenPromise;
}

export async function chromeControlFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await chromeControlToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, cache: 'no-store' });
}
