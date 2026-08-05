'use client';
import { useState, useEffect } from 'react';
import { getCachedSetting } from '@/frontend/lib/serverSettings';
import { useServerSettings } from '@/frontend/hooks/queries/useServerSettings';
import { useGeocode, useWeather } from '@/frontend/hooks/queries/useWeather';

export function WeatherHomeWidget() {
  const serverSettingsQuery = useServerSettings();
  const [browserCoords, setBrowserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const settings = serverSettingsQuery.data;
  const storedLocation = settings?.jarvis_weather_location || getCachedSetting('jarvis_weather_location');
  const storedLatRaw = settings?.jarvis_weather_lat || getCachedSetting('jarvis_weather_lat');
  const storedLonRaw = settings?.jarvis_weather_lon || getCachedSetting('jarvis_weather_lon');
  const storedLat = Number(storedLatRaw);
  const storedLon = Number(storedLonRaw);
  const hasStoredCoords = Boolean(storedLatRaw && storedLonRaw)
    && Number.isFinite(storedLat)
    && Number.isFinite(storedLon);
  const geocodeQuery = useGeocode(storedLocation, 1, !hasStoredCoords);
  const geocoded = geocodeQuery.data?.[0];
  const coords = hasStoredCoords
    ? { lat: storedLat, lon: storedLon }
    : geocoded
      ? { lat: Number(geocoded.lat), lon: Number(geocoded.lon) }
      : browserCoords;
  const weatherQuery = useWeather(coords?.lat, coords?.lon);
  const data = weatherQuery.data;
  const error = weatherQuery.isError
    ? 'Weather unavailable'
    : (!coords && geocodeQuery.isError ? 'Location not available' : '');

  useEffect(() => {
    if (hasStoredCoords || geocoded || (storedLocation && !geocodeQuery.isError)) return;
    navigator.geolocation?.getCurrentPosition((position) => {
      setBrowserCoords({ lat: position.coords.latitude, lon: position.coords.longitude });
    });
  }, [geocodeQuery.isError, geocoded, hasStoredCoords, storedLocation]);

  if (error) return <div className="flex-1 flex items-center justify-center"><p className="font-mono text-[10px] text-white/25">{error}</p></div>;
  if (!data)  return <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;

  return (
    <div className="flex items-center gap-4 px-1">
      <img src={data.icon} alt={data.condition} className="w-14 h-14 object-contain shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <div className="flex-1">
        <div className="font-mono text-3xl font-bold text-white leading-none">{Math.round(data.temp)}°</div>
        <div className="font-mono text-xs text-white/70 mt-0.5">{data.condition}</div>
        <div className="font-mono text-[10px] text-white/40 mt-0.5">{data.city}</div>
        <div className="flex gap-3 mt-1.5">
          <span className="font-mono text-[10px] text-white/50">💨 {data.wind} mph</span>
          <span className="font-mono text-[10px] text-white/50">H {Math.round(data.hi)}°</span>
          <span className="font-mono text-[10px] text-white/50">L {Math.round(data.lo)}°</span>
        </div>
      </div>
    </div>
  );
}
