import { act, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from '../src/features/camera/useCamera';

/**
 * Camera lifecycle.
 *
 * The regression suite for a bug found only by running the app with a real
 * webcam: the setup screen and the live screen render DIFFERENT `<video>`
 * elements, and a plain `useRef` does not re-attach the MediaStream when React
 * swaps one for the other. The live view stayed black, `videoWidth` was 0, and
 * the frame sampler skipped every tick - so the session reported
 * "Waiting for the first frame" forever despite a healthy WebSocket.
 */

class FakeTrack {
  stopped = false;
  kind = 'video';
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return { deviceId: 'cam-1' };
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(count = 1) {
    this.tracks = Array.from({ length: count }, () => new FakeTrack());
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}

/**
 * `reject` is passed explicitly rather than inferred from the argument type:
 * in jsdom `DOMException` does NOT extend `Error`, so an `instanceof Error`
 * check silently resolves the rejection fixture as if it were a stream.
 */
function mockMedia(result: FakeStream | DOMException, reject = false) {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: {
      getUserMedia: vi.fn(() =>
        reject ? Promise.reject(result) : Promise.resolve(result),
      ),
      enumerateDevices: vi.fn(() =>
        Promise.resolve([
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Front camera' },
        ]),
      ),
    },
  });
}

beforeEach(() => {
  // jsdom does not implement play(); it throws "not implemented" otherwise.
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

describe('useCamera - stream attachment', () => {
  it('attaches the stream to a video element bound with attachVideo', async () => {
    const stream = new FakeStream();
    mockMedia(stream);

    const { result } = renderHook(() => useCamera());
    const video = document.createElement('video');

    act(() => result.current.attachVideo(video));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('ready');
    expect(video.srcObject).toBe(stream);
  });

  it('RE-attaches when React swaps in a different video element', async () => {
    // This is the bug. The stream is acquired against one element, then the
    // page transitions and React mounts a completely different one.
    const stream = new FakeStream();
    mockMedia(stream);

    const { result } = renderHook(() => useCamera());

    const setupVideo = document.createElement('video');
    act(() => result.current.attachVideo(setupVideo));
    await act(async () => {
      await result.current.start();
    });
    expect(setupVideo.srcObject).toBe(stream);

    // React unmounts the setup video (ref called with null) and mounts the
    // live one.
    const liveVideo = document.createElement('video');
    act(() => result.current.attachVideo(null));
    act(() => result.current.attachVideo(liveVideo));

    // Before the fix this was null, which is why the live view was black.
    expect(liveVideo.srcObject).toBe(stream);
    expect(result.current.videoRef.current).toBe(liveVideo);
  });

  it('survives a real component remount, not just a manual ref call', async () => {
    const stream = new FakeStream();
    mockMedia(stream);

    let camera: ReturnType<typeof useCamera>;
    let swap: (value: boolean) => void = () => {};

    function Harness() {
      const [live, setLive] = useState(false);
      camera = useCamera();
      swap = setLive;
      return live ? (
        <video key="live" data-testid="live" ref={camera.attachVideo} />
      ) : (
        <video key="setup" data-testid="setup" ref={camera.attachVideo} />
      );
    }

    render(<Harness />);
    await act(async () => {
      await camera!.start();
    });
    expect(screen.getByTestId('setup')).toHaveProperty('srcObject', stream);

    // Distinct `key` values force React to unmount one and mount the other -
    // exactly what the setup -> live phase change does.
    act(() => swap(true));

    const liveEl = screen.getByTestId('live');
    expect(liveEl).toHaveProperty('srcObject', stream);
  });

  it('does not reassign a stream that is already attached', async () => {
    const stream = new FakeStream();
    mockMedia(stream);

    const { result } = renderHook(() => useCamera());
    const video = document.createElement('video');
    act(() => result.current.attachVideo(video));
    await act(async () => {
      await result.current.start();
    });

    const playSpy = vi.spyOn(video, 'play');
    act(() => result.current.attachVideo(video));
    // Re-binding the same element must not restart playback.
    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe('useCamera - release', () => {
  it('stops every track, not just the first', async () => {
    const stream = new FakeStream(2);
    mockMedia(stream);

    const { result } = renderHook(() => useCamera());
    const video = document.createElement('video');
    act(() => result.current.attachVideo(video));
    await act(async () => {
      await result.current.start();
    });

    act(() => result.current.stop());

    // The camera light stays on if any track survives.
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(video.srcObject).toBeNull();
  });

  it('releases the camera on unmount', async () => {
    const stream = new FakeStream();
    mockMedia(stream);

    const { result, unmount } = renderHook(() => useCamera());
    const video = document.createElement('video');
    act(() => result.current.attachVideo(video));
    await act(async () => {
      await result.current.start();
    });

    unmount();
    expect(stream.tracks[0].stopped).toBe(true);
  });
});

describe('useCamera - failure states', () => {
  it.each([
    ['NotAllowedError', 'denied', /blocked/i],
    ['NotFoundError', 'not-found', /No camera was found/i],
    ['NotReadableError', 'in-use', /another application/i],
  ])(
    'maps %s to a friendly message',
    async (domName, expectedStatus, messagePattern) => {
      mockMedia(new DOMException('nope', domName), true);

      const { result } = renderHook(() => useCamera());
      await act(async () => {
        await result.current.start();
      });

      expect(result.current.status).toBe(expectedStatus);
      expect(result.current.errorMessage).toMatch(messagePattern);
    },
  );

  it('reports a browser with no getUserMedia at all', async () => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: {},
    });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toMatch(/does not support camera/i);
  });
});
