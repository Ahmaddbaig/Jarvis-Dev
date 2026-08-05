export class JarvisApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'JarvisApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorPayload {
  error?: string | { message?: string; code?: string; details?: unknown };
  message?: string;
  code?: string;
  details?: unknown;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(input, { ...init, signal: signal ?? init.signal });
  const text = await response.text();
  let payload: unknown;

  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const errorPayload = payload && typeof payload === 'object' ? payload as ErrorPayload : undefined;
    const nestedError = errorPayload?.error && typeof errorPayload.error === 'object'
      ? errorPayload.error
      : undefined;
    const message = typeof errorPayload?.error === 'string'
      ? errorPayload.error
      : nestedError?.message || errorPayload?.message || `Request failed with HTTP ${response.status}.`;
    throw new JarvisApiError(
      message,
      response.status,
      nestedError?.code || errorPayload?.code,
      nestedError?.details ?? errorPayload?.details,
    );
  }

  return payload as T;
}
