import { describe, expect, it, vi } from 'vitest';
import {
  acquireMicrophone,
  microphoneConstraints,
  probeMicrophonePermission,
  setMicrophoneStreamMuted,
} from '../frontend/lib/voiceSession/audio-input';

function fakeStream() {
  const tracks = [
    { enabled: true, stop: vi.fn() },
    { enabled: true, stop: vi.fn() },
  ];
  return {
    stream: {
      getAudioTracks: () => tracks,
      getTracks: () => tracks,
    } as unknown as MediaStream,
    tracks,
  };
}

describe('voice microphone input', () => {
  it('builds the same constrained mono microphone request', () => {
    expect(microphoneConstraints('device-1')).toEqual({
      deviceId: { exact: 'device-1' },
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    });
    expect(microphoneConstraints()).not.toHaveProperty('deviceId');
  });

  it('acquires the selected device and applies mute before returning it', async () => {
    const fixture = fakeStream();
    const getUserMedia = vi.fn(async () => fixture.stream);
    const result = await acquireMicrophone({
      deviceId: ' device-1 ',
      muted: true,
      mediaDevices: { getUserMedia },
    });
    expect(result).toEqual({ stream: fixture.stream, usedDefaultFallback: false });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: microphoneConstraints('device-1') });
    expect(fixture.tracks.every((track) => track.enabled === false)).toBe(true);
  });

  it('falls back exactly once when a selected device is unavailable', async () => {
    const fixture = fakeStream();
    const selectedError = new Error('selected device missing');
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(selectedError)
      .mockResolvedValueOnce(fixture.stream);
    const onFallback = vi.fn();
    const result = await acquireMicrophone({
      deviceId: 'missing-device',
      muted: false,
      mediaDevices: { getUserMedia },
      onFallback,
    });
    expect(result.usedDefaultFallback).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: microphoneConstraints() });
    expect(onFallback).toHaveBeenCalledWith(selectedError);
  });

  it('does not loop or fall back after the default microphone fails', async () => {
    const failure = new Error('permission denied');
    const getUserMedia = vi.fn().mockRejectedValue(failure);
    await expect(acquireMicrophone({
      muted: false,
      mediaDevices: { getUserMedia },
    })).rejects.toBe(failure);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('updates every audio track and stops permission-probe tracks', async () => {
    const fixture = fakeStream();
    setMicrophoneStreamMuted(fixture.stream, true);
    expect(fixture.tracks.every((track) => !track.enabled)).toBe(true);
    setMicrophoneStreamMuted(fixture.stream, false);
    expect(fixture.tracks.every((track) => track.enabled)).toBe(true);

    await probeMicrophonePermission({ getUserMedia: async () => fixture.stream });
    for (const track of fixture.tracks) expect(track.stop).toHaveBeenCalledOnce();
  });
});
