export type LanGatewayScope = 'read' | 'control' | 'ai' | 'settings';

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

export function lanApiAllowlistEntries(): readonly string[] {
    return [...LAN_API_ALLOWLIST.keys()].sort();
}
