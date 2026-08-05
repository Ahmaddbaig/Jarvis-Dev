import { describe, expect, it } from 'vitest';
import {
  spectrumBars,
  VISUALIZER_FFT_BARS,
} from '../frontend/hooks/useVisualizerAudio';

describe('visualizer audio spectrum', () => {
  it('keeps the established 64 bounded FFT bars', () => {
    const data = new Uint8Array(256);
    data.fill(128);
    const bars = spectrumBars(data);
    expect(bars).toHaveLength(VISUALIZER_FFT_BARS);
    expect(bars.every((bar) => Number.isFinite(bar) && bar >= 0 && bar <= 1)).toBe(true);
  });

  it('maps silence to zero and maximum energy to capped bars', () => {
    expect(spectrumBars(new Uint8Array(256))).toEqual(new Array(VISUALIZER_FFT_BARS).fill(0));
    const maximum = new Uint8Array(256);
    maximum.fill(255);
    expect(spectrumBars(maximum).every((bar) => bar === 1)).toBe(true);
  });

  it('handles small analyzer buffers without division by zero', () => {
    const bars = spectrumBars(new Uint8Array([0, 64, 128, 255]), 8);
    expect(bars).toHaveLength(8);
    expect(bars.every(Number.isFinite)).toBe(true);
  });
});
