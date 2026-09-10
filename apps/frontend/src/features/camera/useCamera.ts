import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'error';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

interface UseCameraResult {
  /** Read-only access for the frame sampler. To BIND an element, use `attachVideo`. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /**
   * Callback ref for every `<video>` that should show this stream.
   *
   * Use this instead of `videoRef` on the element itself. A plain ref only
   * records which element is current; it does not re-attach the MediaStream
   * when React swaps one video element for another. The session page does
   * exactly that - the setup screen and the live screen render different
   * videos - so a plain ref left the live view black with no frames.
   */
  attachVideo: (element: HTMLVideoElement | null) => void;
  status: CameraStatus;
  errorMessage: string | null;
  devices: CameraDevice[];
  activeDeviceId: string | null;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
  switchDevice: (deviceId: string) => Promise<void>;
}

/**
 * Webcam lifecycle.
 *
 * The single most important guarantee here is that the camera is RELEASED.
 * A tab whose camera light stays on after the patient navigates away is the
 * worst impression this application could make, and it is exactly the bug the
 * superseded CRA prototype had: it called the MediaPipe helper's `stop()`,
 * which detaches the frame callback but leaves the underlying MediaStreamTrack
 * live.
 *
 * So `stopStream` calls `track.stop()` on every track, and it is invoked from
 * unmount, from `pagehide`, and explicitly on session end/cancel.
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  /**
   * Binds a video element to the live stream, whenever React mounts one.
   *
   * Called by React on mount with the element and on unmount with null, so a
   * remount re-attaches automatically. This is what keeps the preview alive
   * across the setup -> live transition.
   */
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (!element) return;

    const stream = streamRef.current;
    if (stream && element.srcObject !== stream) {
      element.srcObject = stream;
      // Autoplay may be deferred until a user gesture; the stream is attached
      // either way and will play on interaction.
      void element.play().catch(() => {});
    }
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const enumerate = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            // Labels are empty until permission is granted - browsers hide
            // them to prevent fingerprinting.
            label: device.label || `Camera ${index + 1}`,
          })),
      );
    } catch {
      // Device enumeration is a convenience; failure must not block a session.
    }
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setErrorMessage(
          'This browser does not support camera access. Try a recent version of Chrome, Edge or Firefox.',
        );
        return;
      }

      setStatus('requesting');
      setErrorMessage(null);
      stopStream();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user',
              },
          audio: false, // never requested - this application has no use for it
        });

        streamRef.current = stream;
        setActiveDeviceId(
          stream.getVideoTracks()[0]?.getSettings().deviceId ?? null,
        );

        // Bind through the same callback the elements use, so there is
        // exactly one place that attaches a stream to a video element.
        attachVideo(videoRef.current);

        setStatus('ready');
        await enumerate();
      } catch (error) {
        stopStream();
        const name = error instanceof DOMException ? error.name : '';

        switch (name) {
          case 'NotAllowedError':
          case 'SecurityError':
            setStatus('denied');
            setErrorMessage(
              'Camera access was blocked. Allow camera permission in your browser, then try again.',
            );
            break;
          case 'NotFoundError':
          case 'OverconstrainedError':
            setStatus('not-found');
            setErrorMessage(
              'No camera was found. Connect a webcam and try again.',
            );
            break;
          case 'NotReadableError':
          case 'AbortError':
            setStatus('in-use');
            setErrorMessage(
              'The camera is being used by another application. Close it and try again.',
            );
            break;
          default:
            setStatus('error');
            setErrorMessage(
              'The camera could not be started. Please try again.',
            );
        }
      }
    },
    [attachVideo, enumerate, stopStream],
  );

  const switchDevice = useCallback(
    async (deviceId: string) => {
      await start(deviceId);
    },
    [start],
  );

  // Release on unmount and when the page is hidden or closed. `pagehide`
  // rather than `beforeunload`: it also fires on mobile tab suspension.
  useEffect(() => {
    const release = () => stopStream();
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      stopStream();
    };
  }, [stopStream]);

  // Memoised: the session page keeps this object in effect dependency arrays,
  // and a fresh object on every render would restart the frame sampler on
  // every incoming pose update.
  return useMemo(
    () => ({
      videoRef,
      attachVideo,
      status,
      errorMessage,
      devices,
      activeDeviceId,
      start,
      stop: stopStream,
      switchDevice,
    }),
    [
      attachVideo,
      status,
      errorMessage,
      devices,
      activeDeviceId,
      start,
      stopStream,
      switchDevice,
    ],
  );
}
