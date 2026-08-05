import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/backend/mcp/server-manager';
import { lanRequestIdentity } from '@/backend/gateway/trusted-request';

export async function GET(req: NextRequest) {
  try {
    const manager = McpServerManager.getInstance();
    if (!lanRequestIdentity(req)) await manager.initialize();
    const servers = manager.getServerStatus();
    const tools = manager.listTools();
    return NextResponse.json({
      servers,
      totalTools: tools.length,
      connectedCount: servers.filter((s) => s.connected).length,
      serverCount: servers.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
