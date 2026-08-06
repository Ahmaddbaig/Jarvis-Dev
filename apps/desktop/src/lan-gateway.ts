import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import httpProxy from 'http-proxy';
import selfsigned from 'selfsigned';
import {
    isLanPageOrAsset,
    lanRouteDecision,
    LAN_SESSION_COOKIE,
    normalizeLanPath,
    stripUntrustedGatewayHeaders,
    type LanGatewayScope,
} from './lan-gateway-policy';

const SESSION_COOKIE = LAN_SESSION_COOKIE;
const PAIRING_PATH = '/__jarvis/pair';
const MAX_BODY_BYTES = 8_192;
const MAX_INTERNAL_RESPONSE_BYTES = 1_048_576;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface LanGatewayInfo {
    readonly available: boolean;
    readonly url?: string;
    readonly pairingUrl?: string;
    readonly port: number;
}

export interface LanGatewayController {
    readonly info: () => LanGatewayInfo;
    readonly close: () => void;
}

interface StartLanGatewayOptions {
    readonly internalPort: number;
    readonly httpsPort: number;
    readonly desktopToken: string;
    readonly userDataPath: string;
    readonly onError?: (error: Error) => void;
}

interface InternalResponse<T> {
    readonly status: number;
    readonly body: T;
}

interface AuthorizedClient {
    readonly id: string;
    readonly name: string;
    readonly scopes: readonly LanGatewayScope[];
}

function getLanIp(): string | null {
    for (const ifaces of Object.values(networkInterfaces())) {
        for (const iface of ifaces ?? []) {
            if (iface.family === 'IPv4' && !iface.internal)
                return iface.address;
        }
    }
    return null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    res.end(JSON.stringify(body));
}

function redirect(res: http.ServerResponse, location: string, clearSession = false): void {
    res.writeHead(303, {
        Location: location,
        'Cache-Control': 'no-store',
        ...(clearSession ? { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } : {}),
    });
    res.end();
}

function parseCookies(header: string | undefined): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const item of (header ?? '').split(';')) {
        const separator = item.indexOf('=');
        if (separator < 1) continue;
        cookies.set(item.slice(0, separator).trim(), item.slice(separator + 1).trim());
    }
    return cookies;
}

function remoteAddress(req: http.IncomingMessage): string {
    return req.socket.remoteAddress || 'unknown-local-client';
}

function sameOriginMutation(req: http.IncomingMessage): boolean {
    if (SAFE_METHODS.has((req.method || 'GET').toUpperCase())) return true;
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (!host || !origin || origin !== `https://${host}`) return false;
    const fetchSite = req.headers['sec-fetch-site'];
    return fetchSite === undefined || fetchSite === 'same-origin';
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function pairingPage(message = ''): string {
    const safeMessage = escapeHtml(message);
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair with Jarvis</title><style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#02070a;color:#a5f3fc}.panel{width:min(28rem,calc(100% - 2rem));border:1px solid #155e75;border-radius:.75rem;padding:1.5rem;background:#06131a;box-shadow:0 0 30px #06b6d433}h1{font-size:1.15rem;letter-spacing:.12em;text-transform:uppercase}p{color:#67e8f9aa;line-height:1.5;font-size:.8rem}label{display:block;margin-top:1rem;font-size:.7rem;text-transform:uppercase;letter-spacing:.1em}input{box-sizing:border-box;width:100%;margin-top:.4rem;padding:.75rem;background:#02070a;border:1px solid #155e75;border-radius:.4rem;color:#cffafe;font:inherit}button{width:100%;margin-top:1.25rem;padding:.8rem;border:1px solid #22d3ee;border-radius:.4rem;background:#083344;color:#cffafe;font:inherit;font-weight:700;text-transform:uppercase;letter-spacing:.1em}.error{color:#fca5a5}
</style></head><body><main class="panel"><h1>Pair with Jarvis</h1><p>Generate a six-digit LAN code in Jarvis Settings → System. The code expires after ten minutes and can pair one browser.</p>${safeMessage ? `<p class="error">${safeMessage}</p>` : ''}<form method="post" action="${PAIRING_PATH}"><label>Device name<input name="name" maxlength="80" required value="LAN browser"></label><label>Pairing code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><button type="submit">Pair securely</button></form></main></body></html>`;
}

function html(res: http.ServerResponse, status: number, body: string): void {
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
    });
    res.end(body);
}

function createInternalRequester(options: StartLanGatewayOptions) {
    return function internalRequest<T>(body: unknown): Promise<InternalResponse<T>> {
        const payload = Buffer.from(JSON.stringify(body));
        return new Promise((resolve, reject) => {
            const request = http.request({
                hostname: '127.0.0.1',
                port: options.internalPort,
                path: '/api/lan-gateway/session',
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${options.desktopToken}`,
                    'Content-Type': 'application/json',
                    'Content-Length': String(payload.length),
                    Connection: 'close',
                },
            }, (response) => {
                let size = 0;
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > MAX_INTERNAL_RESPONSE_BYTES) {
                        request.destroy(new Error('Internal authorization response is too large.'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString('utf8');
                        resolve({
                            status: response.statusCode || 500,
                            body: (text ? JSON.parse(text) : {}) as T,
                        });
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            });
            request.on('error', reject);
            request.end(payload);
        });
    };
}

export async function startLanGateway(options: StartLanGatewayOptions): Promise<LanGatewayController> {
    const certPath = path.join(options.userDataPath, 'jarvis-tls.json');
    let pems: { private: string; cert: string };
    if (fs.existsSync(certPath)) {
        pems = JSON.parse(fs.readFileSync(certPath, 'utf8')) as { private: string; cert: string };
    }
    else {
        const certificateOptions = { days: 3650 } as unknown as Parameters<typeof selfsigned.generate>[1];
        const generated = await selfsigned.generate([{ name: 'commonName', value: 'jarvis.local' }], certificateOptions);
        pems = generated;
        fs.writeFileSync(certPath, JSON.stringify(pems), { encoding: 'utf8', mode: 0o600 });
    }
    try { fs.chmodSync(certPath, 0o600); } catch { /* Windows uses the user-data ACL. */ }

    const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${options.internalPort}`,
        ws: false,
        changeOrigin: true,
    });
    proxy.on('error', (error, _request, response) => {
        options.onError?.(error);
        try {
            if (response && 'writeHead' in response && typeof response.writeHead === 'function') {
                response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                response.end(JSON.stringify({ error: 'The internal Jarvis service is unavailable.' }));
            }
        }
        catch { /* The client disconnected before the error response. */ }
    });
    proxy.on('proxyRes', (proxyResponse) => {
        proxyResponse.headers['strict-transport-security'] = 'max-age=31536000';
        proxyResponse.headers['x-content-type-options'] = 'nosniff';
        proxyResponse.headers['referrer-policy'] = 'same-origin';
    });

    const internalRequest = createInternalRequester(options);
    const authorize = async (
        req: http.IncomingMessage,
        requiredScope: LanGatewayScope | null,
        consequential: boolean,
        pathname: string,
    ): Promise<InternalResponse<{ client?: AuthorizedClient; error?: string }>> => {
        const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE) || '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
            return { status: 401, body: { error: 'This browser is not paired with Jarvis.' } };
        }
        return internalRequest({
            action: 'authorize',
            input: {
                token,
                method: req.method || 'GET',
                path: pathname,
                requiredScope,
                consequential,
                remoteAddress: remoteAddress(req),
            },
        });
    };

    const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        let pathname: string;
        try {
            const parsed = new URL(req.url || '/', 'https://jarvis.local').pathname;
            const normalized = normalizeLanPath(parsed);
            if (normalized === null) {
                json(res, 400, { error: 'Malformed request path.' });
                return;
            }
            pathname = normalized;
        }
        catch {
            json(res, 400, { error: 'Malformed request path.' });
            return;
        }

        if (pathname === PAIRING_PATH) {
            if (req.method === 'GET') {
                html(res, 200, pairingPage());
                return;
            }
            if (req.method !== 'POST') {
                json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
                return;
            }
            if (!sameOriginMutation(req)) {
                json(res, 403, { error: 'Cross-origin pairing requests are rejected.' });
                return;
            }
            try {
                const form = new URLSearchParams(await readBody(req));
                const response = await internalRequest<{
                    token?: string;
                    error?: string;
                }>({
                    action: 'exchange',
                    input: {
                        code: form.get('code') || '',
                        clientName: form.get('name') || 'LAN browser',
                        remoteAddress: remoteAddress(req),
                        userAgent: req.headers['user-agent'] || '',
                    },
                });
                if (response.status !== 201 || !response.body.token) {
                    html(res, response.status, pairingPage(response.body.error || 'Pairing failed.'));
                    return;
                }
                res.writeHead(303, {
                    Location: '/',
                    'Cache-Control': 'no-store',
                    'Set-Cookie': `${SESSION_COOKIE}=${response.body.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
                });
                res.end();
            }
            catch (error) {
                html(res, 400, pairingPage(errorMessage(error)));
            }
            return;
        }

        const isApi = pathname === '/api' || pathname.startsWith('/api/');
        const decision = isApi
            ? lanRouteDecision(pathname, req.method || 'GET')
            : { allowed: isLanPageOrAsset(pathname), requiredScope: null, consequential: false };
        if (!decision.allowed) {
            json(res, 403, { error: 'This internal Jarvis route is not exposed through the LAN gateway.' });
            return;
        }
        if (!sameOriginMutation(req)) {
            json(res, 403, { error: 'Mixed-origin state changes are rejected by the LAN gateway.' });
            return;
        }
        const authorization = await authorize(req, decision.requiredScope, decision.consequential, pathname)
            .catch((error): InternalResponse<{ client?: AuthorizedClient; error?: string }> => ({
                status: 502,
                body: { error: errorMessage(error) },
            }));
        if (authorization.status !== 200 || !authorization.body.client) {
            if (isApi) {
                json(res, authorization.status, { error: authorization.body.error || 'LAN authorization failed.' }, {
                    ...(authorization.status === 401 ? { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } : {}),
                });
            }
            else {
                redirect(res, PAIRING_PATH, authorization.status === 401);
            }
            return;
        }

        stripUntrustedGatewayHeaders(req.headers);
        req.headers['x-jarvis-gateway-auth'] = options.desktopToken;
        req.headers['x-jarvis-lan-actor'] = authorization.body.client.id;
        req.headers['x-jarvis-lan-scopes'] = authorization.body.client.scopes.join(',');
        if (!SAFE_METHODS.has((req.method || 'GET').toUpperCase())) req.headers['x-jarvis-csrf-verified'] = '1';
        proxy.web(req, res);
    };

    const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
        void handler(req, res).catch((error) => {
            options.onError?.(error instanceof Error ? error : new Error(String(error)));
            if (!res.headersSent) json(res, 500, { error: 'The LAN gateway failed safely.' });
            else res.end();
        });
    });
    server.on('connection', (socket) => {
        socket.on('error', (error) => {
            if (!['ECONNRESET', 'EPIPE'].includes((error as NodeJS.ErrnoException).code || '')) {
                options.onError?.(error);
            }
        });
    });
    server.on('upgrade', (req, socket) => {
        socket.on('error', () => { /* Connection-level failures are isolated from Electron. */ });
        void (async () => {
            const pathname = new URL(req.url || '/', 'https://jarvis.local').pathname;
            if (!pathname.includes('webpack-hmr') && !pathname.includes('_next/webpack')) {
                socket.destroy();
                return;
            }
            const authorization = await authorize(req, null, false, pathname);
            if (authorization.status !== 200) {
                socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            const key = req.headers['sec-websocket-key'];
            if (!key) {
                socket.destroy();
                return;
            }
            const accept = crypto.createHash('sha1')
                .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                .digest('base64');
            socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
            socket.on('data', () => { /* Keep dev HMR quiet for self-signed LAN clients. */ });
        })().catch(() => socket.destroy());
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.httpsPort, '0.0.0.0', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const info = (): LanGatewayInfo => {
        const ip = getLanIp();
        return ip
            ? {
                available: true,
                url: `https://${ip}:${options.httpsPort}`,
                pairingUrl: `https://${ip}:${options.httpsPort}${PAIRING_PATH}`,
                port: options.httpsPort,
            }
            : { available: false, port: options.httpsPort };
    };
    return {
        info,
        close: () => {
            proxy.close();
            server.close();
        },
    };
}
