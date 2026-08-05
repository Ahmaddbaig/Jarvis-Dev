export interface MutableResourceRef<T> {
  current: T | null;
}

export interface ClosableResource {
  close(): void;
}

export interface StoppableTrack {
  stop(): void;
}

export interface TrackContainer {
  getTracks(): readonly StoppableTrack[];
}

export interface RealtimeTransportResources {
  peerConnection: MutableResourceRef<ClosableResource>;
  dataChannel: MutableResourceRef<ClosableResource>;
  remoteStream: MutableResourceRef<TrackContainer>;
  localStream: MutableResourceRef<TrackContainer>;
}

function releaseClosable(ref: MutableResourceRef<ClosableResource>, errors: unknown[]): void {
  const resource = ref.current;
  ref.current = null;
  if (!resource) return;
  try {
    resource.close();
  } catch (error) {
    errors.push(error);
  }
}

function releaseStream(ref: MutableResourceRef<TrackContainer>, errors: unknown[]): void {
  const stream = ref.current;
  ref.current = null;
  if (!stream) return;
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (error) {
        errors.push(error);
      }
    }
  } catch (error) {
    errors.push(error);
  }
}

export function releaseRealtimeTransport(resources: RealtimeTransportResources): readonly unknown[] {
  const errors: unknown[] = [];
  releaseClosable(resources.peerConnection, errors);
  releaseClosable(resources.dataChannel, errors);
  releaseStream(resources.remoteStream, errors);
  releaseStream(resources.localStream, errors);
  return errors;
}
