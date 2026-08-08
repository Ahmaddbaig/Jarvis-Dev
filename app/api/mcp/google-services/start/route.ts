import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/backend/mcp/server-manager';
import { getGoogleServiceRuntime } from '@/backend/mcp/google-service-runtime';
import {
  googleOAuthClientInfo,
  materializeGoogleOAuthCredentials,
  removeMaterializedGoogleOAuthCredentials,
} from '@/backend/secrets/google-credentials';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Google service setup is desktop-only.' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const serviceId = typeof body?.serviceId === 'string' ? body.serviceId : '';
    const service = getGoogleServiceRuntime(serviceId);

    if (!service) {
      return NextResponse.json(
        { error: `Unknown Google service "${serviceId}"` },
        { status: 400 },
      );
    }

    if (!googleOAuthClientInfo()) {
      return NextResponse.json(
        { error: 'Google OAuth credentials are not configured.' },
        { status: 400 },
      );
    }

    materializeGoogleOAuthCredentials();
    try {
      const manager = McpServerManager.getInstance();
      await manager.initialize();

      const existing = manager.getServer(service.serverName);
      if (existing?.connected) {
        return NextResponse.json({
          success: true,
          skipped: true,
          serviceId: service.id,
          tools: existing.tools.length,
          message: `${service.label} MCP server already connected`,
        });
      }

      if (manager.hasServer(service.serverName)) {
        await manager.removeServer(service.serverName);
      }

      await manager.addServerConfig(service.serverName, {
        command: service.command,
        args: service.args,
        env: service.env,
      });

      const server = manager.getServer(service.serverName);
      return NextResponse.json({
        success: true,
        serviceId: service.id,
        tools: server?.tools?.length ?? 0,
        message: `${service.label} MCP server registered and started`,
      });
    } finally {
      removeMaterializedGoogleOAuthCredentials();
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Google service setup is desktop-only.' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const serviceId = searchParams.get('serviceId') ?? '';
    const service = getGoogleServiceRuntime(serviceId);

    if (!service) {
      return NextResponse.json(
        { error: `Unknown Google service "${serviceId}"` },
        { status: 400 },
      );
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();
    await manager.removeServer(service.serverName);

    return NextResponse.json({
      success: true,
      serviceId: service.id,
      message: `${service.label} MCP server removed`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
