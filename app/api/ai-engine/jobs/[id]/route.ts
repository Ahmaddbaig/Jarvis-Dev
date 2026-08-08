import { NextRequest, NextResponse } from 'next/server';
import { aiEngineJobSchema } from '@jarvis/contracts';
import { requestAIEngine } from '@/backend/ai-engine/client';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function validJobId(value: string): boolean {
  return /^job_[a-f0-9]{32}$/.test(value);
}

async function handle(request: NextRequest, context: RouteContext, method: 'GET' | 'DELETE') {
  if (!isAuthenticatedDesktopRequest(request)) {
    return NextResponse.json({ error: 'AI engine jobs are desktop-only.' }, { status: 401 });
  }
  const { id } = await context.params;
  if (!validJobId(id)) return NextResponse.json({ error: 'Invalid AI engine job id.' }, { status: 400 });
  try {
    const job = await requestAIEngine<unknown>(`/v1/jobs/${id}`, { method }, 5_000);
    return NextResponse.json(aiEngineJobSchema.parse(job), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI engine job request failed.' }, { status });
  }
}

export function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context, 'GET');
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context, 'DELETE');
}
