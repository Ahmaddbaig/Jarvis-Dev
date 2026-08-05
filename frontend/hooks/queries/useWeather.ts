'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/frontend/lib/query/fetchJson';
import { queryKeys } from '@/frontend/lib/query/keys';

export interface WeatherData {
  temperature: number;
  windspeed: number;
  condition: string;
  icon: string;
  isDay: boolean;
  city: string;
  state: string;
  high: number | null;
  low: number | null;
  // Transitional aliases consumed by older widgets.
  temp: number;
  wind: number;
  hi: number;
  lo: number;
  tempF: number;
  tempC: number;
  feelsLikeF: number;
  humidity: number | null;
  windMph: number;
  windDir: string;
  description: string;
  uvIndex: number | null;
}

type WeatherResponse = Omit<WeatherData,
  'temp' | 'wind' | 'hi' | 'lo' | 'tempF' | 'tempC' | 'feelsLikeF' |
  'humidity' | 'windMph' | 'windDir' | 'description' | 'uvIndex'>;

export interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
}

export function geocodeQueryOptions(query: string, limit = 1) {
  return queryOptions({
    queryKey: queryKeys.geocode.search(query, limit),
    queryFn: ({ signal }) => fetchJson<GeocodeResult[]>(
      `/api/geocode?q=${encodeURIComponent(query)}&limit=${limit}`,
      {},
      signal,
    ),
    staleTime: 24 * 60 * 60_000,
  });
}

export function useWeather(latitude?: number, longitude?: number) {
  const enabled = Number.isFinite(latitude) && Number.isFinite(longitude);
  return useQuery({
    queryKey: queryKeys.weather.location(latitude ?? 0, longitude ?? 0),
    queryFn: async ({ signal }) => {
      const response = await fetchJson<WeatherResponse>(
        `/api/weather?lat=${latitude}&lon=${longitude}`,
        {},
        signal,
      );
      return {
        ...response,
        temp: response.temperature,
        wind: response.windspeed,
        hi: response.high ?? response.temperature,
        lo: response.low ?? response.temperature,
        tempF: response.temperature,
        tempC: Math.round((response.temperature - 32) * 5 / 9),
        feelsLikeF: response.temperature,
        humidity: null,
        windMph: response.windspeed,
        windDir: '',
        description: response.condition,
        uvIndex: null,
      } satisfies WeatherData;
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useGeocode(query: string, limit = 1, enabled = true) {
  return useQuery({
    ...geocodeQueryOptions(query, limit),
    enabled: enabled && query.trim().length > 0,
  });
}
