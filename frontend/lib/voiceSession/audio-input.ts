export interface MicrophoneAcquisition {
  stream: MediaStream;
  usedDefaultFallback: boolean;
}

export interface MicrophoneOptions {
  deviceId?: string;
  muted: boolean;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  onFallback?: (error: unknown) => void;
}

export function microphoneConstraints(deviceId?: string): MediaTrackConstraints {
  const selected = deviceId?.trim();
  return {
    ...(selected ? { deviceId: { exact: selected } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  };
}

export function setMicrophoneStreamMuted(stream: MediaStream | null, muted: boolean): void {
  stream?.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });
}

export async function acquireMicrophone(options: MicrophoneOptions): Promise<MicrophoneAcquisition> {
  const mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
  const selected = options.deviceId?.trim();
  let stream: MediaStream;
  let usedDefaultFallback = false;
  try {
    stream = await mediaDevices.getUserMedia({ audio: microphoneConstraints(selected) });
  } catch (error) {
    if (!selected) throw error;
    options.onFallback?.(error);
    usedDefaultFallback = true;
    stream = await mediaDevices.getUserMedia({ audio: microphoneConstraints() });
  }
  setMicrophoneStreamMuted(stream, options.muted);
  return { stream, usedDefaultFallback };
}

export async function probeMicrophonePermission(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
): Promise<void> {
  const stream = await mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}
