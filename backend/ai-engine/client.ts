import fs from 'node:fs';
import path from 'node:path';
import {
  AI_ENGINE_PROTOCOL,
  aiEngineSessionDescriptorSchema,
  type AIEngineSessionDescriptor,
} from '@jarvis/contracts';

const SESSION_FILE = 'jarvis-ai-engine-session.json';

export class AIEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIEngineUnavailableError';
  }
}

function sessionPath(): string {
  return path.join(process.env.JARVIS_DATA_DIR || process.cwd(), SESSION_FILE);
}

function readSession(): AIEngineSessionDescriptor {
  const filePath = sessionPath();
  let stat: fs.Stats;
  let raw: string;
  try {
    stat = fs.statSync(filePath);
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AIEngineUnavailableError('The supervised AI engine is not running.');
    }
    throw new AIEngineUnavailableError(`The AI engine session cannot be read: ${String(error)}`);
  }
  if (!stat.isFile()) throw new AIEngineUnavailableError('The AI engine session path is not a file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new AIEngineUnavailableError('The AI engine session permissions are unsafe.');
  }
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new AIEngineUnavailableError('The AI engine session belongs to another user.');
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch {
    throw new AIEngineUnavailableError('The AI engine session is invalid JSON.');
  }
  const parsed = aiEngineSessionDescriptorSchema.safeParse(payload);
  if (!parsed.success || parsed.data.protocol !== AI_ENGINE_PROTOCOL) {
    throw new AIEngineUnavailableError('The AI engine session contract is invalid.');
  }
  try { process.kill(parsed.data.pid, 0); } catch {
    throw new AIEngineUnavailableError('The AI engine session process is no longer running.');
  }
  return parsed.data;
}

export async function requestAIEngine<T>(
  endpoint: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  if (!endpoint.startsWith('/v1/')) throw new Error('AI engine endpoints must use the v1 contract.');
  const session = readSession();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.token}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${session.port}${endpoint}`, {
      ...init,
      headers,
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    throw new AIEngineUnavailableError(`The AI engine request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.json().catch(() => null) as T | { detail?: unknown; error?: unknown } | null;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
      ? body.detail
      : `AI engine returned HTTP ${response.status}.`;
    const error = new Error(detail) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}
