import { NextRequest, NextResponse } from 'next/server';
import { getGoogleService } from '@/shared/google-services';
import { googleServiceAuthenticated } from '@/backend/secrets/google-credentials';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const serviceId = searchParams.get('service') ?? 'calendar';
  const service = getGoogleService(serviceId);

  if (!service) {
    return NextResponse.json(
      { error: `Unknown Google service "${serviceId}"` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    serviceId: service.id,
    authenticated: googleServiceAuthenticated(service.id),
  });
}
