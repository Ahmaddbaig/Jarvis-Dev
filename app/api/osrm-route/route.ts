import { NextResponse } from 'next/server';
import {
  getDrivingRoute,
  mapProviderErrorResponse,
  parseMapCoordinate,
} from '@/backend/maps/providers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slng = searchParams.get('slng');
  const slat = searchParams.get('slat');
  const elng = searchParams.get('elng');
  const elat = searchParams.get('elat');

  try {
    const route = await getDrivingRoute({
      longitude: parseMapCoordinate(slng, 'longitude'),
      latitude: parseMapCoordinate(slat, 'latitude'),
    }, {
      longitude: parseMapCoordinate(elng, 'longitude'),
      latitude: parseMapCoordinate(elat, 'latitude'),
    });
    return NextResponse.json({
      geometry: route.geometry,
      distanceM: route.distance,
      durationS: route.duration,
      distanceMi: (route.distance / 1609.34).toFixed(1),
      durationMin: Math.round(route.duration / 60),
    });
  } catch (err) {
    const { message, status } = mapProviderErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
