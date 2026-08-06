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

export interface MediaSink {
  srcObject: unknown;
}

export interface RealtimeTransportResources {
  peerConnection: MutableResourceRef<ClosableResource>;
  dataChannel: MutableResourceRef<ClosableResource>;
  remoteStream: MutableResourceRef<TrackContainer>;
  localStream: MutableResourceRef<TrackContainer>;
  remoteAudio?: MutableResourceRef<MediaSink>;
}

// Closing a peer connection or data channel fires its state callbacks
// asynchronously. A handler that survives teardown reports the *previous*
// transport's death against whatever session is current by then, so handlers
// are detached before close rather than after.
const PEER_CONNECTION_HANDLERS = [
  'onconnectionstatechange', 'oniceconnectionstatechange', 'onicegatheringstatechange',
  'onsignalingstatechange', 'onicecandidate', 'onnegotiationneeded', 'ontrack', 'ondatachannel',
] as const;

const DATA_CHANNEL_HANDLERS = ['onopen', 'onclose', 'onerror', 'onmessage'] as const;

function detachHandlers(resource: ClosableResource, handlerNames: readonly string[], errors: unknown[]): void {
  for (const name of handlerNames) {
    try {
      (resource as unknown as Record<string, unknown>)[name] = null;
    } catch (error) {
      errors.push(error);
    }
  }
}

function releaseClosable(
  ref: MutableResourceRef<ClosableResource>,
  errors: unknown[],
  handlerNames: readonly string[] = [],
): void {
  const resource = ref.current;
  ref.current = null;
  if (!resource) return;
  detachHandlers(resource, handlerNames, errors);
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
  releaseClosable(resources.peerConnection, errors, PEER_CONNECTION_HANDLERS);
  releaseClosable(resources.dataChannel, errors, DATA_CHANNEL_HANDLERS);
  releaseStream(resources.remoteStream, errors);
  releaseStream(resources.localStream, errors);
  // The audio element outlives the transport, so a stale MediaStream would
  // otherwise stay attached until the next ontrack.
  if (resources.remoteAudio?.current) {
    try {
      resources.remoteAudio.current.srcObject = null;
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
