'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { useWeather } from '@/frontend/hooks/queries/useWeather';

export interface SidePanelData {
  label: string;
  fullAddress?: string;
  lat: number;
  lng: number;
}

interface Props {
  data: SidePanelData;
  onClose: () => void;
  onRouteHere: (dest: string) => void;
  onSearchNearby: (query: string) => void;
}

export function MapSidePanel({ data, onClose, onRouteHere, onSearchNearby }: Props) {
  const [routeQuery, setRouteQuery] = useState('');
  const [nearbyQuery, setNearbyQuery] = useState('');
  const weatherQuery = useWeather(data.lat, data.lng);
  const weather = weatherQuery.data;
  const loadingWeather = weatherQuery.isPending;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className="absolute top-0 right-0 bottom-0 w-[300px] z-30 flex flex-col bg-black/80 backdrop-blur-md border-l border-cyan-500/20 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-cyan-500/10 shrink-0">
        <div className="flex-1 min-w-0 pr-2">
          <h2 className="text-[13px] font-mono font-bold text-white truncate leading-tight">
            {data.label}
          </h2>
          {data.fullAddress && (
            <p className="text-[10px] font-mono text-white/35 mt-1 leading-snug line-clamp-2">
              {data.fullAddress}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/70 transition-colors shrink-0 text-sm"
        >
          ✕
        </button>
      </div>

      {/* Coordinates */}
      <div className="flex gap-3 px-4 py-2.5 border-b border-white/[0.04] shrink-0">
        <div className="flex-1">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest">Lat</div>
          <div className="text-[11px] font-mono text-white/60 tabular-nums">{data.lat.toFixed(5)}</div>
        </div>
        <div className="flex-1">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest">Lng</div>
          <div className="text-[11px] font-mono text-white/60 tabular-nums">{data.lng.toFixed(5)}</div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Weather */}
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest mb-2">
            Current Weather
          </div>
          {loadingWeather ? (
            <div className="text-[10px] font-mono text-white/20">Loading…</div>
          ) : weather ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Image src={weather.icon} alt={weather.condition} width={32} height={32} className="w-8 h-8 object-contain shrink-0" />
                <div>
                  <div className="text-[18px] font-mono font-bold text-white leading-none">
                    {weather.tempF}°F
                    <span className="text-[11px] text-white/40 ml-1 font-normal">/ {weather.tempC}°C</span>
                  </div>
                  <div className="text-[10px] font-mono text-white/50 mt-0.5">{weather.description}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {[
                  { label: 'Feels', value: `${weather.feelsLikeF}°F` },
                  { label: 'Humidity', value: weather.humidity == null ? '—' : `${weather.humidity}%` },
                  { label: 'Wind', value: `${weather.windMph} mph ${weather.windDir}` },
                  { label: 'UV', value: weather.uvIndex == null ? '—' : String(weather.uvIndex) },
                ].map((item) => (
                  <div key={item.label} className="bg-white/[0.03] rounded p-1.5 border border-white/[0.05]">
                    <div className="text-[8px] font-mono text-white/30 uppercase">{item.label}</div>
                    <div className="text-[10px] font-mono text-white/65 mt-0.5">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-white/20">Unavailable</div>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest mb-2">
            Get Directions Here
          </div>
          <div className="flex gap-1.5">
            <input
              value={routeQuery}
              onChange={(e) => setRouteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && routeQuery.trim()) {
                  onRouteHere(routeQuery.trim());
                  setRouteQuery('');
                }
              }}
              placeholder="From where?"
              className="flex-1 bg-white/[0.04] border border-white/8 rounded px-2 py-1.5 text-[11px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={() => { if (routeQuery.trim()) { onRouteHere(routeQuery.trim()); setRouteQuery(''); } }}
              className="px-2.5 py-1.5 bg-cyan-500/15 border border-cyan-500/30 rounded text-cyan-400 text-[10px] font-mono hover:bg-cyan-500/25 transition-colors"
            >
              Go
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest mb-2">
            Search Nearby
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {['Coffee', 'Restaurants', 'Gas', 'Hotels', 'Hospitals', 'Parking'].map((q) => (
              <button
                key={q}
                onClick={() => onSearchNearby(q)}
                className="px-2 py-1 text-[9px] font-mono text-white/40 border border-white/[0.07] rounded hover:text-cyan-400 hover:border-cyan-500/30 transition-colors uppercase tracking-wide"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={nearbyQuery}
              onChange={(e) => setNearbyQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nearbyQuery.trim()) {
                  onSearchNearby(nearbyQuery.trim());
                  setNearbyQuery('');
                }
              }}
              placeholder="Search nearby…"
              className="flex-1 bg-white/[0.04] border border-white/8 rounded px-2 py-1.5 text-[11px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={() => { if (nearbyQuery.trim()) { onSearchNearby(nearbyQuery.trim()); setNearbyQuery(''); } }}
              className="px-2.5 py-1.5 bg-white/[0.04] border border-white/8 rounded text-white/40 text-[10px] font-mono hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
