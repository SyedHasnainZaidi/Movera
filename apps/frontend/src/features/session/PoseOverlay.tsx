import { useEffect, useRef } from 'react';
import type { PoseLandmark } from '../../types/api';

/**
 * Skeleton edges. Kept in step with SKELETON_EDGES in
 * services/pose-service/app/landmarks/registry.py so the drawing and the
 * analysis agree about what connects to what.
 */
const EDGES: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  // The leg ends at the ankle. YOLOv8 emits the 17-point COCO set, which has
  // no heel or foot-index keypoints - those were MediaPipe-only, and drawing
  // to them produced no line at all once the detector changed.
  ['nose', 'left_shoulder'],
  ['nose', 'right_shoulder'],
];

interface PoseOverlayProps {
  landmarks: PoseLandmark[];
  /** Landmarks the server could not see well enough to use. */
  missing: string[];
  trackingValid: boolean;
  /** Preview is CSS-mirrored, so the overlay must mirror to match. */
  mirrored?: boolean;
  width: number;
  height: number;
}

/**
 * Draws the detected skeleton over the video preview.
 *
 * Coordinates arrive NORMALISED (0-1 of frame width/height), which is exactly
 * what a canvas needs - multiply by canvas size. The mirroring is applied here,
 * to the drawing only: the frames sent for analysis are never flipped, so the
 * server's notion of left and right stays anatomically correct.
 *
 * The skeleton is redrawn once per result, exactly where the server measured
 * it.
 *
 * DO NOT reintroduce interpolation here. An earlier revision eased every
 * landmark towards its newest position on each animation frame, on the theory
 * that filling in the gaps between ten results a second would look smoother
 * than stepping between them. It did the opposite. Easing towards a target
 * means never quite arriving at one, so while the patient was actually moving
 * the skeleton sat permanently behind them and read as lag. An overlay that is
 * late is worse than an overlay that steps: this is the one surface whose
 * whole job is to look pinned to the body.
 */
export function PoseOverlay({
  landmarks,
  missing,
  trackingValid,
  mirrored = true,
  width,
  height,
}: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks.length === 0) return;

    const byName = new Map(landmarks.map((point) => [point.name, point]));
    const missingSet = new Set(missing);

    const toX = (x: number) =>
      mirrored ? (1 - x) * canvas.width : x * canvas.width;
    const toY = (y: number) => y * canvas.height;

    // Valid tracking is teal; invalid is amber. Line WIDTH also changes, so
    // the state is not conveyed by colour alone.
    const strokeColour = trackingValid
      ? 'rgba(71, 156, 143, 0.95)'
      : 'rgba(169, 117, 20, 0.9)';

    context.lineWidth = trackingValid ? 4 : 2;
    context.lineCap = 'round';
    context.strokeStyle = strokeColour;

    for (const [from, to] of EDGES) {
      const a = byName.get(from);
      const b = byName.get(to);
      if (!a || !b) continue;
      // Do not draw a limb the server told us it could not see.
      if (missingSet.has(from) || missingSet.has(to)) continue;

      context.beginPath();
      context.moveTo(toX(a.x), toY(a.y));
      context.lineTo(toX(b.x), toY(b.y));
      context.stroke();
    }

    for (const point of landmarks) {
      const isMissing = missingSet.has(point.name);
      const radius = isMissing ? 3 : 5;

      context.beginPath();
      context.arc(toX(point.x), toY(point.y), radius, 0, Math.PI * 2);
      context.fillStyle = isMissing
        ? 'rgba(176, 58, 43, 0.85)' // problem red for a landmark in doubt
        : 'rgba(255, 255, 255, 0.95)';
      context.fill();

      if (!isMissing) {
        context.lineWidth = 2;
        context.strokeStyle = strokeColour;
        context.stroke();
      }
    }
  }, [landmarks, missing, trackingValid, mirrored]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
