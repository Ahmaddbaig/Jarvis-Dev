import { NextResponse } from 'next/server';
import { AIEngineUnavailableError, requestAIEngine } from '@/backend/ai-engine/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const health = await requestAIEngine<Record<string, unknown>>('/v1/health', {}, 3_000);
    return NextResponse.json(health, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unavailable = error instanceof AIEngineUnavailableError;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'AI engine health failed.',
    }, { status: unavailable ? 503 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
