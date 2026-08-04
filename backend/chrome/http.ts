import { NextRequest, NextResponse } from 'next/server';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

export function isLoopbackRequest(req: NextRequest): boolean {
  return LOOPBACK_HOSTS.has(req.nextUrl.hostname);
}

export function isJarvisUiRequest(req: NextRequest): boolean {
  if (!isLoopbackRequest(req)) return false;

  const origin = req.headers.get('origin');
  if (!origin) return false;

  const originHost = hostnameFromOrigin(origin);
  if (!originHost || !LOOPBACK_HOSTS.has(originHost)) return false;

  const fetchSite = req.headers.get('sec-fetch-site');
  return fetchSite === null || fetchSite === 'same-origin';
}

export function extensionOrigin(req: NextRequest): string | null {
  if (!isLoopbackRequest(req)) return null;
  const origin = req.headers.get('origin');
  if (!origin) return 'local-client';
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : null;
}

export function extensionIdFromOrigin(origin: string | null): string | null {
  if (!origin?.startsWith('chrome-extension://')) return null;
  return origin.slice('chrome-extension://'.length);
}

export function extensionCorsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin === 'local-client' ? 'null' : origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export function forbidden(message = 'Chrome control is available only to the local Jarvis UI.') {
  return NextResponse.json({ error: message }, { status: 403 });
}
