import { NextRequest, NextResponse } from 'next/server';
import {
  listCompanionsWithStatus,
  pairCompanion,
  runCompanionCommand,
  unpairCompanionDevice,
} from '@/backend/companion/client';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Companion management is available only in the Jarvis desktop app.' }, { status: 401 });
  }
  return NextResponse.json({ devices: await listCompanionsWithStatus() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: 'Companion management is available only in the Jarvis desktop app.' }, { status: 401 });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.action === 'pair') {
      if (typeof body.address !== 'string' || typeof body.code !== 'string' || typeof body.fingerprint !== 'string') {
        return NextResponse.json({ error: 'Address, pairing code, and fingerprint are required.' }, { status: 400 });
      }
      const device = await pairCompanion({
        address: body.address,
        code: body.code,
        fingerprint: body.fingerprint,
      });
      return NextResponse.json({ success: true, device: { ...device, token: undefined } }, { status: 201 });
    }

    if (body.action === 'remove') {
      if (typeof body.id !== 'string' || !body.id) {
        return NextResponse.json({ error: 'Companion device id is required.' }, { status: 400 });
      }
      return NextResponse.json({ success: await unpairCompanionDevice(body.id) });
    }

    if (body.action === 'command') {
      const target = typeof body.target === 'string' ? body.target : '';
      const command = body.command;
      if (!['status', 'launch', 'input', 'capture'].includes(String(command))) {
        return NextResponse.json({ error: 'Unsupported companion command.' }, { status: 400 });
      }
      const payload = body.payload && typeof body.payload === 'object'
        ? body.payload as Record<string, unknown>
        : {};
      const result = await runCompanionCommand(
        target,
        command as 'status' | 'launch' | 'input' | 'capture',
        payload
      );
      return NextResponse.json({ success: true, target, result });
    }

    return NextResponse.json({ error: 'Unsupported companion action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
