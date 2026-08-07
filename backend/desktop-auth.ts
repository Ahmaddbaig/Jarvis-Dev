import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';

const TOKEN_FILE = '.jarvis-desktop-token';
let cachedToken: string | null = null;

function tokenPath(): string {
  return path.join(process.cwd(), TOKEN_FILE);
}

function validToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function createPrivateTokenFile(filePath: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows has no POSIX mode. */ }
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (!validToken(existing)) throw new Error('The Jarvis desktop token file is invalid.');
    return existing;
  }
}

export function desktopControlToken(): string {
  if (cachedToken) return cachedToken;
  const environmentToken = process.env.JARVIS_DESKTOP_TOKEN?.trim();
  if (validToken(environmentToken)) {
    cachedToken = environmentToken;
    return cachedToken;
  }

  const filePath = tokenPath();
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (validToken(existing)) {
      cachedToken = existing;
      return cachedToken;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  cachedToken = createPrivateTokenFile(filePath);
  return cachedToken;
}

export function isAuthenticatedDesktopRequest(req: NextRequest): boolean {
  const authorization = req.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const expected = Buffer.from(desktopControlToken());
  const actual = Buffer.from(match[1]);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
