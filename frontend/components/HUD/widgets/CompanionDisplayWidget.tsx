'use client';

import { useEffect, useState } from 'react';
import { desktopControlFetch } from '@/frontend/lib/desktopControlClient';

interface PreviewFrame {
  mimeType: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  screen: number;
  capturedAt: string;
  imageBase64: string;
}

interface PreviewError {
  error?: string;
}

export function CompanionDisplayWidget({ config }: { config?: Record<string, unknown> }) {
  const target = typeof config?.target === 'string' ? config.target : '';
  const name = typeof config?.name === 'string' ? config.name : target || 'Companion';
  const configuredScreen = Number(config?.screen);
  const [screen, setScreen] = useState(Number.isInteger(configuredScreen) && configuredScreen >= 0 ? configuredScreen : 0);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!target || paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await desktopControlFetch(
          `/api/companions/preview?target=${encodeURIComponent(target)}&screen=${screen}`,
          { cache: 'no-store', signal: controller.signal }
        );
        const data = await response.json() as PreviewFrame & PreviewError;
        if (!response.ok) throw new Error(data.error || `Preview failed with HTTP ${response.status}.`);
        if (!cancelled) {
          setFrame(data);
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled && !(pollError instanceof DOMException && pollError.name === 'AbortError')) {
          setError(pollError instanceof Error ? pollError.message : String(pollError));
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [paused, retryKey, screen, target]);

  if (!target) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center text-xs text-red-300">
        No companion computer was selected.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black select-none">
      {frame ? (
        // A frequently changing data URL is intentionally rendered as a plain
        // img rather than going through Next's static image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:${frame.mimeType};base64,${frame.imageBase64}`}
          alt={`${name} display ${screen}`}
          className="h-full w-full object-contain pointer-events-none"
        />
      ) : (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-cyan-500/70">
          <div className="h-6 w-6 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase">Connecting to {name}</span>
        </div>
      )}

      <div className="absolute left-2 top-2 flex items-center gap-2 rounded bg-black/75 px-2 py-1 backdrop-blur-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber-400' : error ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />
        <span className="font-mono text-[9px] tracking-widest text-cyan-100/80 uppercase">
          {paused ? 'Paused' : error ? 'Signal lost' : 'Live'}
        </span>
      </div>

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded bg-black/80 px-2 py-1.5 backdrop-blur-sm">
        <span className="min-w-0 truncate font-mono text-[9px] text-cyan-200/70">
          SCREEN {screen}{frame ? ` · ${frame.displayWidth}×${frame.displayHeight}` : ''}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Previous companion display"
            onClick={(event) => {
              event.stopPropagation();
              setScreen((current) => Math.max(0, current - 1));
            }}
            disabled={screen === 0}
            className="rounded border border-cyan-500/25 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 disabled:opacity-25"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Next companion display"
            onClick={(event) => {
              event.stopPropagation();
              setScreen((current) => current + 1);
            }}
            className="rounded border border-cyan-500/25 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300"
          >
            +
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (error) setRetryKey((current) => current + 1);
              setPaused((current) => !current);
            }}
            className="rounded border border-cyan-500/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/10"
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      {error && (
        <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 rounded border border-red-400/30 bg-black/90 p-3 text-center backdrop-blur-sm">
          <p className="text-[10px] leading-relaxed text-red-300">{error}</p>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPaused(false);
              setRetryKey((current) => current + 1);
            }}
            className="mt-2 rounded border border-cyan-500/30 px-2 py-1 text-[9px] uppercase tracking-widest text-cyan-300"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
