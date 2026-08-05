import { NextResponse } from 'next/server';
import { GOOGLE_SERVICES } from '@/shared/google-services';
import { McpServerManager } from '@/backend/mcp/server-manager';
import { getGoogleServiceRuntime } from '@/backend/mcp/google-service-runtime';
import { googleOAuthClientInfo, googleServiceAuthenticated } from '@/backend/secrets/google-credentials';

export async function GET() {
  try {
    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const services = GOOGLE_SERVICES.map((service) => {
      const runtime = getGoogleServiceRuntime(service.id);
      const server = manager.getServer(service.serverName);

      return {
        id: service.id,
        label: service.label,
        shortLabel: service.shortLabel,
        serverName: service.serverName,
        configured: manager.hasServer(service.serverName),
        connected: server?.connected ?? false,
        tools: server?.tools?.length ?? 0,
        serverInfo: server?.serverInfo ?? null,
        authenticated: runtime ? googleServiceAuthenticated(service.id) : false,
      };
    });

    return NextResponse.json({
      hasCredentials: googleOAuthClientInfo() !== null,
      services,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
