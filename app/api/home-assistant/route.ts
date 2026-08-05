import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';
import { getCoreStore } from '@/backend/persistence/core-store';
import { getCredentialService } from '@/backend/secrets/credential-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeHaUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

function configuredHomeAssistant(): { url: string; token: string } | null {
  const url = normalizeHaUrl(getCoreStore().readServerSettings().jarvis_ha_url ?? '');
  const token = getCredentialService().get('homeAssistantToken') ?? '';
  return url && token ? { url, token } : null;
}

async function requestHomeAssistant(
  request: NextRequest,
  config: { url: string; token: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${config.url}${path}`, {
    ...init,
    signal: request.signal,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

export async function GET(req: NextRequest) {
  const config = configuredHomeAssistant();
  if (!config) return NextResponse.json({ error: 'Home Assistant is not configured.' }, { status: 401 });
  const path = req.nextUrl.searchParams.get('path') ?? '/api/states';
  if (!path.startsWith('/api/') || path.includes('://') || path.length > 2_048) {
    return NextResponse.json({ error: 'Home Assistant path is invalid.' }, { status: 400 });
  }
  try {
    const response = await requestHomeAssistant(req, config, path);
    if (!response.ok) {
      return NextResponse.json({ error: `Home Assistant returned HTTP ${response.status}.` }, { status: response.status });
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return new NextResponse(null, { status: 499 });
    return NextResponse.json({ error: 'Failed to reach Home Assistant.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.action === 'configure') {
      if (!isAuthenticatedDesktopRequest(req)) {
        return NextResponse.json({ error: 'Home Assistant setup is desktop-only.' }, { status: 401 });
      }
      if (typeof body.url !== 'string' || typeof body.token !== 'string' || !body.url || !body.token) {
        return NextResponse.json({ error: 'Home Assistant URL and token are required.' }, { status: 400 });
      }
      const config = { url: normalizeHaUrl(body.url), token: body.token };
      const response = await requestHomeAssistant(req, config, '/api/states');
      if (!response.ok) {
        return NextResponse.json({ error: `Home Assistant returned HTTP ${response.status}.` }, { status: 400 });
      }
      getCredentialService().set('homeAssistantToken', config.token);
      getCoreStore().writeServerSettings({ jarvis_ha_url: config.url });
      const states = await response.json().catch(() => []);
      return NextResponse.json({
        success: true,
        configured: true,
        deviceCount: Array.isArray(states) ? states.length : 0,
      });
    }

    const config = configuredHomeAssistant();
    if (!config) return NextResponse.json({ error: 'Home Assistant is not configured.' }, { status: 401 });
    const domain = typeof body.domain === 'string' ? body.domain : '';
    const service = typeof body.service === 'string' ? body.service : '';
    const serviceData = body.serviceData && typeof body.serviceData === 'object' && !Array.isArray(body.serviceData)
      ? body.serviceData as Record<string, unknown>
      : {};
    if (!/^[a-z0-9_]+$/.test(domain) || !/^[a-z0-9_]+$/.test(service)) {
      return NextResponse.json({ error: 'Home Assistant domain and service are invalid.' }, { status: 400 });
    }
    const response = await requestHomeAssistant(
      req,
      config,
      `/api/services/${domain}/${service}`,
      { method: 'POST', body: JSON.stringify(serviceData) },
    );
    if (!response.ok) {
      return NextResponse.json({ error: `Home Assistant returned HTTP ${response.status}.` }, { status: response.status });
    }
    return NextResponse.json({ success: true, result: await response.json().catch(() => ({})) });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return new NextResponse(null, { status: 499 });
    return NextResponse.json({ error: 'Home Assistant request failed.' }, { status: 500 });
  }
}
