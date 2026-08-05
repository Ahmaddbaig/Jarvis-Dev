const NOMINATIM_DEFAULT_URL = 'https://nominatim.openstreetmap.org/';
const OSRM_DEFAULT_URL = 'https://router.project-osrm.org/';
const PROVIDER_TIMEOUT_MS = 12_000;
const NOMINATIM_MIN_INTERVAL_MS = 1_050;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;
const USER_AGENT = 'Jarvis-Dev/1.1 (+https://github.com/Ahmaddbaig/Jarvis-Dev)';

export interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}

export interface ReverseGeocodeResult {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

export interface DrivingRouteResult {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance: number;
  duration: number;
}

export class MapProviderError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = 'MapProviderError';
  }
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const geocodeCache = new Map<string, CacheEntry<GeocodeResult[]>>();
const reverseCache = new Map<string, CacheEntry<ReverseGeocodeResult>>();
const routeCache = new Map<string, CacheEntry<DrivingRouteResult>>();
let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimStart = 0;

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

function providerUrl(envName: 'JARVIS_NOMINATIM_URL' | 'JARVIS_OSRM_URL', fallback: string, path: string): URL {
  const configured = process.env[envName]?.trim() || fallback;
  try {
    const base = new URL(configured);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('unsupported protocol');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    return new URL(path, base);
  } catch {
    throw new MapProviderError(`${envName} is not a valid HTTP(S) URL.`, 500);
  }
}

async function fetchJson<T>(url: URL, provider: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new MapProviderError(`${provider} returned HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof MapProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MapProviderError(`${provider} timed out.`, 504);
    }
    throw new MapProviderError(`${provider} is unavailable.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function scheduleNominatim<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = nominatimQueue;
  nominatimQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const delay = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimStart));
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    lastNominatimStart = Date.now();
    return await operation();
  } finally {
    release();
  }
}

export function parseMapCoordinate(raw: string | null, kind: 'latitude' | 'longitude'): number {
  if (raw === null || raw.trim() === '') {
    throw new MapProviderError(`Missing ${kind}.`, 400);
  }
  const value = Number(raw);
  const limit = kind === 'latitude' ? 90 : 180;
  if (!Number.isFinite(value) || value < -limit || value > limit) {
    throw new MapProviderError(`Invalid ${kind}.`, 400);
  }
  return value;
}

export async function searchLocations(query: string, limit = 5): Promise<GeocodeResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) throw new MapProviderError('Missing query.', 400);
  if (cleanQuery.length > 300) throw new MapProviderError('Query is too long.', 400);

  const safeLimit = Math.max(1, Math.min(5, Math.trunc(limit)));
  const cacheKey = `${cleanQuery.toLocaleLowerCase()}|${safeLimit}`;
  const cached = cacheGet(geocodeCache, cacheKey);
  if (cached) return cached;

  return scheduleNominatim(async () => {
    const secondCached = cacheGet(geocodeCache, cacheKey);
    if (secondCached) return secondCached;
    const url = providerUrl('JARVIS_NOMINATIM_URL', NOMINATIM_DEFAULT_URL, 'search');
    url.search = new URLSearchParams({
      q: cleanQuery,
      format: 'jsonv2',
      limit: String(safeLimit),
      addressdetails: '1',
    }).toString();
    const data = await fetchJson<unknown>(url, 'Geocoding service');
    if (!Array.isArray(data)) throw new MapProviderError('Geocoding service returned an invalid response.');
    const results = data.filter((item): item is GeocodeResult => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<GeocodeResult>;
      return typeof candidate.lat === 'string'
        && typeof candidate.lon === 'string'
        && typeof candidate.display_name === 'string';
    });
    cacheSet(geocodeCache, cacheKey, results);
    return results;
  });
}

export async function reverseLocation(latitude: number, longitude: number): Promise<ReverseGeocodeResult> {
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = cacheGet(reverseCache, cacheKey);
  if (cached) return cached;

  return scheduleNominatim(async () => {
    const secondCached = cacheGet(reverseCache, cacheKey);
    if (secondCached) return secondCached;
    const url = providerUrl('JARVIS_NOMINATIM_URL', NOMINATIM_DEFAULT_URL, 'reverse');
    url.search = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      addressdetails: '1',
    }).toString();
    const data = await fetchJson<ReverseGeocodeResult>(url, 'Reverse geocoding service');
    cacheSet(reverseCache, cacheKey, data);
    return data;
  });
}

export async function getDrivingRoute(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
): Promise<DrivingRouteResult> {
  const cacheKey = [start.longitude, start.latitude, end.longitude, end.latitude].join(',');
  const cached = cacheGet(routeCache, cacheKey);
  if (cached) return cached;

  const coordinates = `${start.longitude},${start.latitude};${end.longitude},${end.latitude}`;
  const url = providerUrl('JARVIS_OSRM_URL', OSRM_DEFAULT_URL, `route/v1/driving/${coordinates}`);
  url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'false' }).toString();
  const data = await fetchJson<{
    code?: string;
    message?: string;
    routes?: DrivingRouteResult[];
  }>(url, 'Routing service');

  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new MapProviderError(data.message || 'Route not found.', 404);
  }
  const route = data.routes[0];
  if (
    route.geometry?.type !== 'LineString'
    || !Array.isArray(route.geometry.coordinates)
    || route.geometry.coordinates.length === 0
    || !Number.isFinite(route.distance)
    || !Number.isFinite(route.duration)
  ) {
    throw new MapProviderError('Routing service returned an invalid route.');
  }
  cacheSet(routeCache, cacheKey, route);
  return route;
}

export function mapProviderErrorResponse(error: unknown): { message: string; status: number } {
  if (error instanceof MapProviderError) return { message: error.message, status: error.status };
  return { message: 'Map service request failed.', status: 500 };
}
