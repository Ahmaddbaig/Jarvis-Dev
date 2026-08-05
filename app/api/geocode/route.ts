import { NextResponse } from 'next/server';
import { mapProviderErrorResponse, searchLocations } from '@/backend/maps/providers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

  try {
    const requestedLimit = Number(searchParams.get('limit') ?? 5);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 5;
    return NextResponse.json(await searchLocations(q, limit));
  } catch (err) {
    const { message, status } = mapProviderErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
