export async function desktopControlFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await window.electron?.getDesktopControlToken?.();
  if (!token) {
    throw new Error('This action is available only inside the Jarvis desktop app.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
