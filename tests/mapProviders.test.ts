import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getDrivingRoute,
  mapProviderErrorResponse,
  parseMapCoordinate,
  searchLocations,
} from '../backend/maps/providers';

const originalNominatimUrl = process.env.JARVIS_NOMINATIM_URL;
const originalOsrmUrl = process.env.JARVIS_OSRM_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalNominatimUrl === undefined) delete process.env.JARVIS_NOMINATIM_URL;
  else process.env.JARVIS_NOMINATIM_URL = originalNominatimUrl;
  if (originalOsrmUrl === undefined) delete process.env.JARVIS_OSRM_URL;
  else process.env.JARVIS_OSRM_URL = originalOsrmUrl;
});

describe('parseMapCoordinate', () => {
  test('accepts finite coordinates inside geographic bounds', () => {
    expect(parseMapCoordinate('41.8781', 'latitude')).toBe(41.8781);
    expect(parseMapCoordinate('-87.6298', 'longitude')).toBe(-87.6298);
  });

  test('rejects missing, non-finite, and out-of-range coordinates', () => {
    expect(() => parseMapCoordinate(null, 'latitude')).toThrow('Missing latitude');
    expect(() => parseMapCoordinate('NaN', 'longitude')).toThrow('Invalid longitude');
    expect(() => parseMapCoordinate('91', 'latitude')).toThrow('Invalid latitude');
    expect(() => parseMapCoordinate('-181', 'longitude')).toThrow('Invalid longitude');
  });
});

describe('map providers', () => {
  test('uses the configurable Nominatim endpoint with policy-friendly request metadata', async () => {
    process.env.JARVIS_NOMINATIM_URL = 'https://geo.example.test/nominatim/';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '41.88', lon: '-87.63', display_name: 'Chicago, Illinois' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchLocations('Unique test location 418781', 1);

    expect(result[0].display_name).toBe('Chicago, Illinois');
    const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe('https://geo.example.test/nominatim/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(requestOptions.headers['User-Agent']).toContain('Jarvis-Dev');
  });

  test('validates an OSRM response and keeps provider URLs swappable', async () => {
    process.env.JARVIS_OSRM_URL = 'https://route.example.test/osrm/';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          geometry: { type: 'LineString', coordinates: [[-87.63, 41.88], [-87.62, 41.89]] },
          distance: 1609.34,
          duration: 120,
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const route = await getDrivingRoute(
      { latitude: 41.88, longitude: -87.63 },
      { latitude: 41.89, longitude: -87.62 },
    );

    expect(route.distance).toBe(1609.34);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://route.example.test/osrm/route/v1/driving/-87.63,41.88;-87.62,41.89',
    );
  });

  test('returns safe client errors instead of leaking arbitrary failures', () => {
    expect(mapProviderErrorResponse(new Error('secret upstream detail'))).toEqual({
      message: 'Map service request failed.',
      status: 500,
    });
  });
});
