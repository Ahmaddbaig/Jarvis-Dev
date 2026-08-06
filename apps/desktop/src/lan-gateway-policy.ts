/**
 * Mirrors `lanScopeSchema` in @jarvis/contracts. apps/desktop sits outside the
 * npm workspace and uses Node module resolution, so it cannot import the
 * contracts package; tests/lanGatewayPolicy.test.ts asserts the two agree.
 */
export const LAN_GATEWAY_SCOPES = ['read', 'control', 'ai', 'settings'] as const;

export type LanGatewayScope = (typeof LAN_GATEWAY_SCOPES)[number];

export const LAN_SESSION_COOKIE = '__Host-jarvis_lan';

/**
 * Headers that convey trust downstream. A LAN client may send any of these;
 * none may survive into the proxied request, which re-adds them from
 * server-side state only.
 */
export const UNTRUSTED_INBOUND_HEADERS = [
    'authorization',
    'x-jarvis-gateway-auth',
    'x-jarvis-lan-actor',
    'x-jarvis-lan-scopes',
    'x-jarvis-csrf-verified',
    'x-jarvis-gateway-verified',
] as const;

export interface LanRouteDecision {
    readonly allowed: boolean;
    readonly requiredScope: LanGatewayScope | null;
    readonly consequential: boolean;
}

const DENIED: LanRouteDecision = { allowed: false, requiredScope: null, consequential: false };

function allowed(requiredScope: LanGatewayScope, consequential = false): LanRouteDecision {
    return { allowed: true, requiredScope, consequential };
}

const LAN_API_ALLOWLIST = new Map<string, LanRouteDecision>([
    ['GET /api/ai-engine/health', allowed('read')],
    ['GET /api/ai-engine/models', allowed('read')],
    ['GET /api/bambu/printers', allowed('read')],
    ['GET /api/bambu/status', allowed('read')],
    ['GET /api/bambu/tasks', allowed('read')],
    ['GET /api/bambu/telemetry', allowed('read')],
    ['POST /api/bambu/command', allowed('control', true)],
    ['POST /api/datasheet-search', allowed('read')],
    ['GET /api/geocode', allowed('read')],
    ['GET /api/home-assistant', allowed('read')],
    ['POST /api/home-assistant', allowed('control', true)],
    ['GET /api/ical', allowed('read')],
    ['POST /api/image-generation', allowed('ai', true)],
    ['GET /api/mcp', allowed('read')],
    ['GET /api/mcp/auth-status', allowed('read')],
    ['GET /api/mcp/calendar-events', allowed('read')],
    ['POST /api/mcp/create-event', allowed('control', true)],
    ['GET /api/mcp/credentials', allowed('read')],
    ['DELETE /api/mcp/delete-event', allowed('control', true)],
    ['POST /api/mcp/delete-event', allowed('control', true)],
    ['GET /api/mcp/google-services', allowed('read')],
    ['GET /api/mcp/status', allowed('read')],
    ['GET /api/music', allowed('read')],
    ['POST /api/music', allowed('control', true)],
    ['GET /api/news-headlines', allowed('read')],
    ['GET /api/osrm-route', allowed('read')],
    ['GET /api/settings', allowed('read')],
    ['POST /api/settings', allowed('settings', true)],
    ['GET /api/skills', allowed('read')],
    ['GET /api/stock-quote', allowed('read')],
    ['GET /api/tasks', allowed('read')],
    ['PUT /api/tasks', allowed('control', true)],
    ['GET /api/voice/chat', allowed('ai')],
    ['POST /api/voice/chat', allowed('ai', true)],
    ['GET /api/voice/profiles', allowed('read')],
    ['POST /api/voice/speak', allowed('ai')],
    ['POST /api/voice/transcribe', allowed('ai', true)],
    ['POST /api/voice/warmup', allowed('ai')],
    ['GET /api/weather', allowed('read')],
    ['POST /api/web-search', allowed('read')],
    ['POST /api/xray', allowed('ai', true)],
]);

export function lanRouteDecision(pathname: string, method: string): LanRouteDecision {
    const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    return LAN_API_ALLOWLIST.get(`${method.toUpperCase()} ${normalizedPath}`) ?? DENIED;
}

export function isLanPageOrAsset(pathname: string): boolean {
    return !pathname.startsWith('/api/') && pathname !== '/api';
}

/**
 * Resolve a request path to the single form every downstream guard will see,
 * or null if it cannot be resolved unambiguously.
 *
 * `URL` leaves `%2F` encoded, so `/api%2Fsettings` is one opaque segment:
 * the API allowlist does not recognise it as an API route, and neither does
 * the Next proxy matcher — while the upstream router may still resolve it.
 * Both guards then fail open. Rather than guess which parser wins, any path
 * carrying an encoded separator, a traversal segment, or malformed encoding
 * is refused outright.
 */
export function normalizeLanPath(pathname: string): string | null {
    if (/%2f|%5c/i.test(pathname)) return null;
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    if (decoded.includes('\\') || decoded.includes('\0')) return null;
    if (decoded.split('/').includes('..')) return null;
    return decoded;
}

/**
 * Remove every client-supplied header and cookie that the gateway itself is
 * authoritative for. Mutates and returns the same headers object.
 */
export function stripUntrustedGatewayHeaders<T extends Record<string, unknown>>(headers: T): T {
    for (const name of UNTRUSTED_INBOUND_HEADERS) delete headers[name];
    const cookie = typeof headers.cookie === 'string' ? headers.cookie : undefined;
    const retained = (cookie ?? '').split(';')
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith(`${LAN_SESSION_COOKIE}=`));
    if (retained.length) (headers as Record<string, unknown>).cookie = retained.join('; ');
    else delete headers.cookie;
    return headers;
}

export function lanApiAllowlistEntries(): readonly string[] {
    return [...LAN_API_ALLOWLIST.keys()].sort();
}
