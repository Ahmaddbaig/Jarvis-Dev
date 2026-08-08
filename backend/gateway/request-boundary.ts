const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const EXTENSION_PATH_PREFIX = '/api/chrome-control/';

export interface BoundaryRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Pick<Headers, 'get'>;
}

export interface BoundaryDecision {
  readonly allowed: boolean;
  readonly kind: 'gateway' | 'desktop' | 'loopback' | 'extension' | 'denied';
  readonly status?: 401 | 403;
  readonly reason?: string;
}

function validSecret(value: string | null, expected: string | undefined): boolean {
  return Boolean(expected && /^[A-Za-z0-9_-]{43}$/.test(expected) && value === expected);
}

function bearerToken(headers: Pick<Headers, 'get'>): string | null {
  const match = (headers.get('authorization') ?? '').match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}

function isLoopbackUrl(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

function effectiveRequestOrigin(requestUrl: URL, host: string | null): URL | null {
  try {
    const effective = host ? new URL(`${requestUrl.protocol}//${host}`) : requestUrl;
    return isLoopbackUrl(effective) ? effective : null;
  } catch {
    return null;
  }
}

function isSameLoopbackOrigin(origin: string | null, requestUrl: URL, host: string | null): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const effective = effectiveRequestOrigin(requestUrl, host);
    if (!effective) return false;
    return isLoopbackUrl(parsed)
      && parsed.protocol === effective.protocol
      && parsed.hostname === effective.hostname
      && parsed.port === effective.port;
  } catch {
    return false;
  }
}

export function evaluateRequestBoundary(
  request: BoundaryRequest,
  desktopToken = process.env.JARVIS_DESKTOP_TOKEN,
): BoundaryDecision {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const fetchSite = request.headers.get('sec-fetch-site');
  const gatewayToken = request.headers.get('x-jarvis-gateway-auth');
  const gatewayActor = request.headers.get('x-jarvis-lan-actor');
  const gatewayTrusted = validSecret(gatewayToken, desktopToken)
    && Boolean(gatewayActor?.startsWith('lan-client:'));

  if (gatewayTrusted) {
    if (!SAFE_METHODS.has(method) && request.headers.get('x-jarvis-csrf-verified') !== '1') {
      return { allowed: false, kind: 'denied', status: 403, reason: 'LAN_CSRF_UNVERIFIED' };
    }
    return { allowed: true, kind: 'gateway' };
  }

  if (validSecret(bearerToken(request.headers), desktopToken)) {
    return { allowed: true, kind: 'desktop' };
  }

  if (url.pathname.startsWith(EXTENSION_PATH_PREFIX)
    && (method === 'OPTIONS' || /^chrome-extension:\/\/[a-p]{32}$/.test(origin ?? ''))) {
    return { allowed: true, kind: 'extension' };
  }

  if (!isLoopbackUrl(url) || !effectiveRequestOrigin(url, host)) {
    return { allowed: false, kind: 'denied', status: 401, reason: 'LOOPBACK_REQUIRED' };
  }
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return { allowed: false, kind: 'denied', status: 403, reason: 'CROSS_SITE_REJECTED' };
  }
  if (origin && !isSameLoopbackOrigin(origin, url, host)) {
    return { allowed: false, kind: 'denied', status: 403, reason: 'CROSS_ORIGIN_REJECTED' };
  }
  if (!SAFE_METHODS.has(method) && !isSameLoopbackOrigin(origin, url, host)) {
    return { allowed: false, kind: 'denied', status: 403, reason: 'MUTATION_ORIGIN_REQUIRED' };
  }
  return { allowed: true, kind: 'loopback' };
}
