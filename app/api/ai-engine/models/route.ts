import { NextRequest, NextResponse } from 'next/server';
import {
  aiEngineModelActionSchema,
  aiEngineModelsSchema,
  aiEngineJobSchema,
} from '@jarvis/contracts';
import { requestAIEngine } from '@/backend/ai-engine/client';
import { isAuthenticatedDesktopRequest } from '@/backend/desktop-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 503;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'AI model request failed.' }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET() {
  try {
    const models = await requestAIEngine<unknown>('/v1/models', {}, 5_000);
    return NextResponse.json(aiEngineModelsSchema.parse(models), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthenticatedDesktopRequest(request)) {
    return NextResponse.json({ error: 'Model lifecycle control is desktop-only.' }, { status: 401 });
  }
  const parsed = aiEngineModelActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'The model lifecycle action is invalid.', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const job = await requestAIEngine<unknown>('/v1/models', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    }, 5_000);
    return NextResponse.json(aiEngineJobSchema.parse(job), { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
