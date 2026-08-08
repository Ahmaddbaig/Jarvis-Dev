import { describe, expect, it, vi } from 'vitest';
import {
  releaseRealtimeTransport,
  type RealtimeTransportResources,
} from '../frontend/lib/voiceSession/realtimeResources';

function resources(): {
  values: RealtimeTransportResources;
  closePeer: ReturnType<typeof vi.fn>;
  closeChannel: ReturnType<typeof vi.fn>;
  stopLocal: ReturnType<typeof vi.fn>;
  stopRemote: ReturnType<typeof vi.fn>;
} {
  const closePeer = vi.fn();
  const closeChannel = vi.fn();
  const stopLocal = vi.fn();
  const stopRemote = vi.fn();
  return {
    closePeer,
    closeChannel,
    stopLocal,
    stopRemote,
    values: {
      peerConnection: { current: { close: closePeer } },
      dataChannel: { current: { close: closeChannel } },
      remoteStream: { current: { getTracks: () => [{ stop: stopRemote }] } },
      localStream: { current: { getTracks: () => [{ stop: stopLocal }] } },
    },
  };
}

describe('realtime transport resource release', () => {
  it('closes transport resources, stops every track, and clears ownership', () => {
    const fixture = resources();
    expect(releaseRealtimeTransport(fixture.values)).toEqual([]);
    expect(fixture.closePeer).toHaveBeenCalledOnce();
    expect(fixture.closeChannel).toHaveBeenCalledOnce();
    expect(fixture.stopRemote).toHaveBeenCalledOnce();
    expect(fixture.stopLocal).toHaveBeenCalledOnce();
    for (const ref of Object.values(fixture.values)) expect(ref.current).toBeNull();
  });

  it('is idempotent after ownership has been cleared', () => {
    const fixture = resources();
    releaseRealtimeTransport(fixture.values);
    releaseRealtimeTransport(fixture.values);
    expect(fixture.closePeer).toHaveBeenCalledOnce();
    expect(fixture.closeChannel).toHaveBeenCalledOnce();
    expect(fixture.stopRemote).toHaveBeenCalledOnce();
    expect(fixture.stopLocal).toHaveBeenCalledOnce();
  });

  it('continues releasing resources when one close or track stop throws', () => {
    const fixture = resources();
    fixture.closePeer.mockImplementation(() => { throw new Error('peer close failed'); });
    fixture.stopRemote.mockImplementation(() => { throw new Error('track stop failed'); });
    const errors = releaseRealtimeTransport(fixture.values);

    expect(errors).toHaveLength(2);
    expect(fixture.closeChannel).toHaveBeenCalledOnce();
    expect(fixture.stopLocal).toHaveBeenCalledOnce();
    for (const ref of Object.values(fixture.values)) expect(ref.current).toBeNull();
  });
});
