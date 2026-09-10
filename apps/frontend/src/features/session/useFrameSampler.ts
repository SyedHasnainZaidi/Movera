import { useCallback, useEffect, useMemo, useRef } from 'react';

const SAMPLE_FPS = Number(import.meta.env.VITE_POSE_FRAME_SAMPLE_FPS ?? 10);
const IMAGE_WIDTH = Number(import.meta.env.VITE_POSE_IMAGE_WIDTH ?? 480);
const IMAGE_QUALITY = Number(import.meta.env.VITE_POSE_IMAGE_QUALITY ?? 0.6);

interface UseFrameSamplerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Return false to skip this tick (e.g. the socket is still busy). */
  canSend: () => boolean;
  onFrame: (blob: Blob) => void;
}

interface UseFrameSamplerResult {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  config: { fps: number; width: number; quality: number };
}

/**
 * Samples the video element and emits compressed JPEG frames.
 *
 * Why sample rather than stream every frame: the camera produces 30 fps, but
 * MediaPipe inference measures around 30 ms per frame on CPU, so anything
 * above roughly 10 fps just builds a queue. 10 fps at 480 px wide and quality
 * 0.6 gives frames of about 25-40 KB, which is comfortable over a local
 * network and plenty of temporal resolution for a rehabilitation repetition
 * lasting one to three seconds.
 *
 * Driven by requestAnimationFrame with an elapsed-time gate rather than
 * setInterval: rAF pauses automatically when the tab is hidden, so a
 * backgrounded tab stops uploading frames instead of quietly consuming
 * bandwidth and analysis slots.
 */
export function useFrameSampler({
  videoRef,
  canSend,
  onFrame,
}: UseFrameSamplerOptions): UseFrameSamplerResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastSentRef = useRef(0);

  const handlersRef = useRef({ canSend, onFrame });
  handlersRef.current = { canSend, onFrame };

  const getCanvas = useCallback((): HTMLCanvasElement => {
    if (!canvasRef.current) {
      // Offscreen: never attached to the DOM, so it costs no layout.
      canvasRef.current = document.createElement('canvas');
    }
    return canvasRef.current;
  }, []);

  const tick = useCallback(() => {
    if (!runningRef.current) return;
    rafRef.current = requestAnimationFrame(tick);

    const now = performance.now();
    const interval = 1000 / SAMPLE_FPS;
    if (now - lastSentRef.current < interval) return;

    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    if (!handlersRef.current.canSend()) return;

    lastSentRef.current = now;

    const canvas = getCanvas();
    const scale = IMAGE_WIDTH / video.videoWidth;
    canvas.width = IMAGE_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    // Drawn UNMIRRORED on purpose. The preview is mirrored with CSS because a
    // mirrored view feels natural, but flipping the pixels sent for analysis
    // would swap the patient's left and right - so the server would report a
    // left-knee fault for a right-knee problem.
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob && runningRef.current) {
          handlersRef.current.onFrame(blob);
        }
      },
      'image/jpeg',
      IMAGE_QUALITY,
    );
  }, [getCanvas, videoRef]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    lastSentRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  // Memoised: the session page depends on this object in an effect. A fresh
  // object each render would stop and restart the sampler on every incoming
  // pose update - roughly ten times a second.
  return useMemo(
    () => ({
      start,
      stop,
      isRunning: () => runningRef.current,
      config: { fps: SAMPLE_FPS, width: IMAGE_WIDTH, quality: IMAGE_QUALITY },
    }),
    [start, stop],
  );
}
