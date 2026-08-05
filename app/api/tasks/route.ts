import { NextRequest, NextResponse } from 'next/server';
import { localTaskListSchema } from '@jarvis/contracts';
import { getCoreStore } from '@/backend/persistence/core-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ tasks: getCoreStore().database.tasks.list() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tasks storage is unavailable.' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const parsed = localTaskListSchema.safeParse(
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { tasks?: unknown }).tasks
        : undefined,
    );
    if (!parsed.success) {
      return NextResponse.json({ error: 'Tasks payload is invalid.', issues: parsed.error.issues }, { status: 400 });
    }
    getCoreStore().database.tasks.replaceAll(parsed.data);
    return NextResponse.json({ ok: true, tasks: parsed.data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tasks could not be saved.' },
      { status: 500 },
    );
  }
}
