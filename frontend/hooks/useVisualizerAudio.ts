'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { VoiceSessionStatus } from '../lib/voiceSession/state';

export const VISUALIZER_FFT_BARS = 64;

export function spectrumBars(
  data: Uint8Array<ArrayBuffer>,
  barCount = VISUALIZER_FFT_BARS,
): number[] {
  const result: number[] = [];
  const usefulBins = Math.floor(data.length / 2);
  const samplesPerBar = usefulBins / barCount;
  for (let index = 0; index < barCount; index += 1) {
    let sum = 0;
    const start = Math.floor(index * samplesPerBar);
    const end = Math.max(start + 1, Math.floor((index + 1) * samplesPerBar));
    for (let bin = start; bin < end && bin < data.length; bin += 1) sum += data[bin];
    const normalized = (sum / Math.max(1, end - start)) / 255;
    result.push(Math.min(Math.pow(normalized, 0.5) * 1.8, 1));
  }
  return result;
}

export function useVisualizerAudio(options: {
  status: VoiceSessionStatus;
  remoteStreamRef: RefObject<MediaStream | null>;
  polledEngineActive: boolean;
  getPolledOutputVolume: () => number;
}) {
  const [audioLevel, setAudioLevel] = useState(0);
  const [fftData, setFftData] = useState<number[]>(
    new Array(VISUALIZER_FFT_BARS).fill(0),
  );
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const polledFrameRef = useRef<number | null>(null);
  const getPolledOutputVolumeRef = useRef(options.getPolledOutputVolume);

  useEffect(() => {
    getPolledOutputVolumeRef.current = options.getPolledOutputVolume;
  }, [options.getPolledOutputVolume]);

  useEffect(() => {
    if (options.status !== 'active') {
      const resetTimer = window.setTimeout(() => {
        setAudioLevel(0);
        setFftData(new Array(VISUALIZER_FFT_BARS).fill(0));
      }, 0);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      if (audioContextRef.current) void audioContextRef.current.close();
      audioContextRef.current = null;
      return () => window.clearTimeout(resetTimer);
    }

    const checkStream = window.setInterval(() => {
      const stream = options.remoteStreamRef.current;
      if (!stream) return;
      window.clearInterval(checkStream);
      try {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);

        const update = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          const average = data.reduce((sum, value) => sum + value, 0) / data.length;
          const volume = Math.min(Math.pow(Math.min(average / 128, 1), 0.6) * 1.5, 1);
          setAudioLevel(volume);
          setFftData(spectrumBars(data));
          animationFrameRef.current = requestAnimationFrame(update);
        };
        update();
      } catch (error) {
        console.error('Failed to setup audio analyzer:', error);
      }
    }, 100);

    return () => {
      window.clearInterval(checkStream);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      if (audioContextRef.current) void audioContextRef.current.close();
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [options.status, options.remoteStreamRef]);

  useEffect(() => {
    if (options.status !== 'active' || !options.polledEngineActive) {
      if (polledFrameRef.current) cancelAnimationFrame(polledFrameRef.current);
      polledFrameRef.current = null;
      return;
    }
    const poll = () => {
      const volume = getPolledOutputVolumeRef.current();
      setAudioLevel(volume);
      const time = Date.now() / 250;
      setFftData(Array.from({ length: VISUALIZER_FFT_BARS }, (_, index) => {
        const wave = Math.abs(Math.sin(time + index * 0.35)) * volume;
        const noise = Math.random() * 0.12 * volume;
        return Math.min(1, wave + noise);
      }));
      polledFrameRef.current = requestAnimationFrame(poll);
    };
    poll();
    return () => {
      if (polledFrameRef.current) cancelAnimationFrame(polledFrameRef.current);
      polledFrameRef.current = null;
    };
  }, [options.status, options.polledEngineActive]);

  return { audioLevel, fftData };
}
