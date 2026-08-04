import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  CHROME_CONTROL_ACTIONS,
  ChromeControlAction,
  ChromeControlCommand,
  ChromeControlResult,
  ChromeControlStatus,
} from './types';

interface PersistedPairing {
  tokenHash: string;
  extensionId: string;
  extensionName: string;
  pairedAt: string;
}

interface PairingCode {
  code: string;
  expiresAt: number;
  failedAttempts: number;
}

interface PendingResult {
  resolve: (value: ChromeControlResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ChromeRuntimeState {
  pairing: PersistedPairing | null;
  pairingCode: PairingCode | null;
  lastSeenAt: number;
  queue: ChromeControlCommand[];
  pollWaiters: Array<(command: ChromeControlCommand | null) => void>;
  pendingResults: Map<string, PendingResult>;
  completedCommandIds: Map<string, number>;
}

const PAIRING_CODE_TTL_MS = 10 * 60_000;
const ONLINE_WINDOW_MS = 35_000;
const COMMAND_TIMEOUT_MS = 45_000;
const MAX_QUEUE_SIZE = 20;
const MAX_RESULT_BYTES = 2_500_000;

function dataDirectory(): string {
  return process.env.JARVIS_DATA_DIR || process.cwd();
}

function pairingPath(): string {
  return path.join(dataDirectory(), 'jarvis-chrome-control.json');
}

function readPairing(): PersistedPairing | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pairingPath(), 'utf8')) as Partial<PersistedPairing>;
    if (
      typeof parsed.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.tokenHash) ||
      typeof parsed.extensionId !== 'string' || !/^[a-p]{32}$/.test(parsed.extensionId) ||
      typeof parsed.extensionName !== 'string' ||
      typeof parsed.pairedAt !== 'string'
    ) {
      return null;
    }
    return parsed as PersistedPairing;
  } catch {
    return null;
  }
}

function writePairing(pairing: PersistedPairing): void {
  fs.mkdirSync(dataDirectory(), { recursive: true });
  fs.writeFileSync(pairingPath(), JSON.stringify(pairing, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(pairingPath(), 0o600);
  } catch {
    // Windows does not implement POSIX modes; the user profile directory remains the boundary.
  }
}

function getState(): ChromeRuntimeState {
  const root = globalThis as typeof globalThis & { __jarvisChromeRuntime?: ChromeRuntimeState };
  if (!root.__jarvisChromeRuntime) {
    root.__jarvisChromeRuntime = {
      pairing: readPairing(),
      pairingCode: null,
      lastSeenAt: 0,
      queue: [],
      pollWaiters: [],
      pendingResults: new Map(),
      completedCommandIds: new Map(),
    };
  }
  return root.__jarvisChromeRuntime;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function failPendingCommands(message: string): void {
  const state = getState();
  state.queue = [];
  for (const [commandId, pending] of state.pendingResults) {
    clearTimeout(pending.timeout);
    pending.resolve({ commandId, ok: false, error: message });
  }
  state.pendingResults.clear();
  state.completedCommandIds.clear();
  for (const waiter of state.pollWaiters.splice(0)) waiter(null);
}

export function createChromePairingCode(): { code: string; expiresAt: string } {
  const state = getState();
  const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
  const code = String(crypto.randomInt(100_000, 1_000_000));
  state.pairingCode = { code, expiresAt, failedAttempts: 0 };
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

export function pairChromeExtension(input: {
  code: string;
  extensionId: string;
  extensionName?: string;
}): { token: string; status: ChromeControlStatus } {
  const state = getState();
  const pairingCode = state.pairingCode;
  if (!pairingCode || Date.now() >= pairingCode.expiresAt) {
    state.pairingCode = null;
    throw new Error('The pairing code expired. Generate a new code in Jarvis Settings.');
  }
  if (pairingCode.failedAttempts >= 8) {
    state.pairingCode = null;
    throw new Error('Too many incorrect pairing attempts. Generate a new code.');
  }
  if (!/^[a-p]{32}$/.test(input.extensionId)) {
    throw new Error('Invalid Chrome extension identifier.');
  }
  if (!/^\d{6}$/.test(input.code) || input.code !== pairingCode.code) {
    pairingCode.failedAttempts += 1;
    throw new Error('Incorrect pairing code.');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const pairing: PersistedPairing = {
    tokenHash: tokenHash(token),
    extensionId: input.extensionId,
    extensionName: (input.extensionName || 'Jarvis Chrome').replace(/[^a-z0-9 ._()-]/gi, '').slice(0, 80),
    pairedAt: new Date().toISOString(),
  };

  failPendingCommands('Chrome was re-paired. Retry the command.');
  state.pairing = pairing;
  state.pairingCode = null;
  state.lastSeenAt = Date.now();
  writePairing(pairing);
  return { token, status: chromeControlStatus() };
}

export function revokeChromePairing(): void {
  const state = getState();
  failPendingCommands('Chrome pairing was revoked.');
  state.pairing = null;
  state.pairingCode = null;
  state.lastSeenAt = 0;
  try {
    fs.unlinkSync(pairingPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function verifyChromeToken(token: string, extensionId?: string | null): boolean {
  const pairing = getState().pairing;
  if (!pairing || typeof token !== 'string' || token.length < 32 || token.length > 128) return false;
  if (extensionId && extensionId !== pairing.extensionId) return false;
  return safeEqualHex(tokenHash(token), pairing.tokenHash);
}

export function chromeControlStatus(): ChromeControlStatus {
  const state = getState();
  const pairing = state.pairing;
  return {
    paired: Boolean(pairing),
    connected: Boolean(pairing) && Date.now() - state.lastSeenAt < ONLINE_WINDOW_MS,
    extensionName: pairing?.extensionName,
    extensionId: pairing?.extensionId,
    pairedAt: pairing?.pairedAt,
    lastSeen: state.lastSeenAt > 0 ? new Date(state.lastSeenAt).toISOString() : undefined,
    extensionPath: process.env.JARVIS_CHROME_EXTENSION_PATH && path.isAbsolute(process.env.JARVIS_CHROME_EXTENSION_PATH)
      ? path.normalize(process.env.JARVIS_CHROME_EXTENSION_PATH)
      : path.join(process.cwd(), 'chrome-extension'),
    supportedEndpoints: ['http://127.0.0.1:3100', 'http://127.0.0.1:3000'],
  };
}

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\0\r]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function exactTypedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length > max) throw new Error(`Typed text cannot exceed ${max} characters.`);
  if (value.includes('\0')) throw new Error('Typed text cannot contain a null character.');
  return value;
}

function normalizeCommandArgs(action: ChromeControlAction, raw: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const tabId = Number(raw.tabId);
  if (Number.isInteger(tabId) && tabId >= 0) args.tabId = tabId;

  if (action === 'search') {
    const query = cleanString(raw.query, 500);
    if (!query) throw new Error('Search requires a query.');
    args.query = query;
  }

  if (action === 'open_tab' || action === 'navigate') {
    const url = normalizeUrl(raw.url);
    if (!url) throw new Error('A complete http:// or https:// URL is required.');
    args.url = url;
  }

  if (action === 'switch_tab' || action === 'close_tab') {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error(`${action} requires a tabId from list_tabs.`);
  }

  if (action === 'click' || action === 'type') {
    const selector = cleanString(raw.selector, 500);
    const text = action === 'type' ? exactTypedText(raw.text, 4_000) : cleanString(raw.text, 500);
    if (selector) args.selector = selector;
    if (text !== undefined) args.text = text;
    if (action === 'click' && !selector && !text) throw new Error('Click requires a selector or visible text.');
    if (action === 'type' && (!selector || text === undefined)) throw new Error('Type requires both selector and text.');
    if (action === 'type') args.replace = raw.replace !== false;
    if (action === 'click' && raw.confirmed === true) {
      const confirmationId = cleanString(raw.confirmationId, 80);
      if (!confirmationId) throw new Error('Confirmed clicks require a one-time confirmation identifier.');
      args.confirmed = true;
      args.confirmationId = confirmationId;
    }
  }

  if (action === 'press_key') {
    const key = cleanString(raw.key, 40);
    if (!key || !/^(?:Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End|Backspace|Delete)$/.test(key)) {
      throw new Error('Unsupported key.');
    }
    if (raw.ctrl === true || raw.alt === true || raw.meta === true || (raw.shift === true && key !== 'Tab')) {
      throw new Error('Keyboard shortcuts are not supported. Shift is allowed only with Tab.');
    }
    args.key = key;
    args.shift = raw.shift === true;
    if (raw.confirmed === true) args.confirmed = true;
  }

  if (action === 'close_tab' && raw.confirmed === true) args.confirmed = true;

  if (action === 'scroll') {
    const direction = raw.direction;
    if (!['up', 'down', 'top', 'bottom'].includes(String(direction))) throw new Error('Scroll direction must be up, down, top, or bottom.');
    args.direction = direction;
    const amount = Number(raw.amount);
    if (Number.isFinite(amount)) args.amount = Math.max(100, Math.min(2_000, Math.round(amount)));
  }

  if (action === 'find') {
    const query = cleanString(raw.query, 300);
    if (!query) throw new Error('Find requires text to locate on the page.');
    args.query = query;
  }

  return args;
}

export function createChromeCommand(actionValue: unknown, rawArgs: unknown): ChromeControlCommand {
  if (typeof actionValue !== 'string' || !CHROME_CONTROL_ACTIONS.includes(actionValue as ChromeControlAction)) {
    throw new Error('Unsupported Chrome action.');
  }
  const action = actionValue as ChromeControlAction;
  const inputArgs = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : {};
  return {
    id: crypto.randomUUID(),
    action,
    args: normalizeCommandArgs(action, inputArgs),
    createdAt: new Date().toISOString(),
  };
}

export function issueChromeCommand(command: ChromeControlCommand): Promise<ChromeControlResult> {
  const state = getState();
  if (!state.pairing) {
    return Promise.resolve({ commandId: command.id, ok: false, error: 'Pair the Jarvis Chrome extension in Settings first.' });
  }
  if (Date.now() - state.lastSeenAt >= ONLINE_WINDOW_MS) {
    return Promise.resolve({ commandId: command.id, ok: false, error: 'The Jarvis Chrome extension is paired but offline. Open Chrome and the extension popup.' });
  }
  if (state.queue.length >= MAX_QUEUE_SIZE) {
    return Promise.resolve({ commandId: command.id, ok: false, error: 'The Chrome command queue is full.' });
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      state.pendingResults.delete(command.id);
      state.queue = state.queue.filter((queued) => queued.id !== command.id);
      resolve({ commandId: command.id, ok: false, error: 'Chrome did not complete the command within 45 seconds.' });
    }, COMMAND_TIMEOUT_MS);
    state.pendingResults.set(command.id, { resolve, timeout });

    const waiter = state.pollWaiters.shift();
    if (waiter) waiter(command);
    else state.queue.push(command);
  });
}

export function pollChromeCommand(timeoutMs = 12_000, signal?: AbortSignal): Promise<ChromeControlCommand | null> {
  const state = getState();
  state.lastSeenAt = Date.now();
  const queued = state.queue.shift();
  if (queued) return Promise.resolve(queued);

  return new Promise((resolve) => {
    let finished = false;
    const waiter = (command: ChromeControlCommand | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve(command);
    };
    const onAbort = () => {
      state.pollWaiters = state.pollWaiters.filter((candidate) => candidate !== waiter);
      waiter(null);
    };
    const timeout = setTimeout(() => {
      state.pollWaiters = state.pollWaiters.filter((candidate) => candidate !== waiter);
      waiter(null);
    }, Math.max(1_000, Math.min(timeoutMs, 15_000)));
    state.pollWaiters.push(waiter);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function completeChromeCommand(result: ChromeControlResult): boolean {
  const state = getState();
  state.lastSeenAt = Date.now();
  const completedBefore = Date.now() - 5 * 60_000;
  for (const [commandId, completedAt] of state.completedCommandIds) {
    if (completedAt < completedBefore) state.completedCommandIds.delete(commandId);
  }
  const pending = state.pendingResults.get(result.commandId);
  if (!pending) return state.completedCommandIds.has(result.commandId);

  let safeResult = result;
  try {
    if (JSON.stringify(result).length > MAX_RESULT_BYTES) {
      safeResult = { commandId: result.commandId, ok: false, error: 'Chrome returned more data than Jarvis accepts.' };
    }
  } catch {
    safeResult = { commandId: result.commandId, ok: false, error: 'Chrome returned a non-serializable result.' };
  }

  clearTimeout(pending.timeout);
  state.pendingResults.delete(result.commandId);
  while (state.completedCommandIds.size >= 500) {
    const oldest = state.completedCommandIds.keys().next().value as string | undefined;
    if (!oldest) break;
    state.completedCommandIds.delete(oldest);
  }
  state.completedCommandIds.set(result.commandId, Date.now());
  pending.resolve(safeResult);
  return true;
}
