import type { ReactNode } from 'react';
import { useEasedValue } from './motion';

/**
 * Instruments.
 *
 * The readouts a physiotherapist would recognise, rather than the generic
 * progress bars and stat boxes they replace. Each one exists because the
 * underlying number has a shape:
 *
 *   Goniometer  - a joint angle is an arc, and it has a target RANGE, so the
 *                 acceptable band can be drawn rather than described.
 *   TallyTrack  - repetitions are counted objects; thirty of them read faster
 *                 as thirty marks than as a filled bar.
 *   ProgressRing- a held position is a duration under threat of being lost;
 *                 a closing ring shows how much is banked.
 *   SignalBars  - camera confidence is a signal, and everyone already knows
 *                 what signal bars mean.
 *
 * All four take their colour from `currentColor` wherever possible, so the
 * same component works on the light pages and on the dark session console
 * without a variant prop.
 */

/** Cartesian point on a circle. Screen y grows downwards, so sin is negated. */
function polar(cx: number, cy: number, r: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(radians), y: cy - r * Math.sin(radians) };
}

/** Arc swept clockwise on screen, from the larger angle to the smaller one. */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  fromDegrees: number,
  toDegrees: number,
) {
  const start = polar(cx, cy, r, fromDegrees);
  const end = polar(cx, cy, r, toDegrees);
  const large = Math.abs(fromDegrees - toDegrees) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * A joint angle, drawn the way it is measured.
 *
 * The needle is driven by an EASED copy of the value while the label prints
 * the true one. Landmark estimates jitter by a degree or two between frames at
 * ten frames a second; easing the needle removes the buzz without ever
 * showing a number the analysis did not produce.
 *
 * `band` is the range the current rule set accepts. Drawing it puts the
 * measurement in context - a patient can see they are outside the target
 * without reading anything - but it is always accompanied by the written cue
 * in the feedback banner, never left to the graphic alone.
 */
export function Goniometer({
  value,
  label,
  unit = '°',
  min = 0,
  max = 180,
  band,
  inBand,
  size = 168,
}: {
  value: number;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  band?: { min?: number; max?: number };
  /** Whether the value currently satisfies the rule. Drives colour + wording. */
  inBand?: boolean;
  size?: number;
}) {
  const eased = useEasedValue(value);

  const cx = 100;
  const cy = 92;
  const r = 74;

  // The gauge runs left (min) to right (max) across the top half, so reading
  // it left to right means the same thing as reading a number line.
  const toAngle = (v: number) =>
    180 - (clamp(v, min, max) - min) / (max - min) * 180;

  const needle = toAngle(eased);
  /*
   * The pointer rides the arc instead of running from the hub.
   *
   * A full-length needle sweeps straight through the middle of the dial, which
   * is exactly where the measured value has to be printed - at 90° the two
   * collided and the number became unreadable. A short pointer sitting on the
   * scale leaves the centre clear and reads more like the instrument anyway.
   */
  const pointerInner = polar(cx, cy, r - 15, needle);
  const pointerOuter = polar(cx, cy, r + 5, needle);

  const bandFrom = band?.min !== undefined ? toAngle(band.min) : null;
  const bandTo = band?.max !== undefined ? toAngle(band.max) : null;

  const ticks = [];
  for (let step = 0; step <= 12; step += 1) {
    const angle = 180 - step * 15;
    const major = step % 3 === 0;
    const outer = polar(cx, cy, r, angle);
    const inner = polar(cx, cy, r - (major ? 11 : 6), angle);
    ticks.push(
      <line
        key={step}
        x1={outer.x}
        y1={outer.y}
        x2={inner.x}
        y2={inner.y}
        strokeWidth={major ? 1.75 : 1}
        strokeLinecap="round"
        className={major ? 'opacity-80' : 'opacity-45'}
        stroke="currentColor"
      />,
    );
  }

  return (
    <figure className="m-0 flex flex-col items-center">
      <svg
        viewBox="0 0 200 100"
        width={size}
        height={size / 2}
        role="img"
        aria-label={`${label}: ${value.toFixed(1)}${unit}`}
        className="overflow-visible"
      >
        {/* the dial face: every 15°, with a longer mark every 45° */}
        <g>{ticks}</g>

        <path
          d={arcPath(cx, cy, r, 180, 0)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="opacity-30"
        />

        {/* the range the rule set accepts */}
        {bandFrom !== null && bandTo !== null && (
          <path
            d={arcPath(cx, cy, r, bandFrom, bandTo)}
            fill="none"
            stroke="currentColor"
            strokeWidth={7}
            strokeLinecap="butt"
            className="opacity-25"
          />
        )}

        {/* travelled so far, so the reading has length as well as a position */}
        <path
          d={arcPath(cx, cy, r, 180, needle)}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* the pointer */}
        <line
          x1={pointerInner.x}
          y1={pointerInner.y}
          x2={pointerOuter.x}
          y2={pointerOuter.y}
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>

      {/*
        The reading sits under the dial rather than inside it. A goniometer has
        an open hinge, and leaving the middle empty is both truer to the
        instrument and the only arrangement where the pointer can reach every
        angle without crossing the number.

        One text node, deliberately: the value and its unit have to read as a
        single string to a screen reader and to a test, so they are never split
        across elements.
      */}
      <figcaption className="mt-1 text-center">
        <p className="type-display type-measure text-[26px] leading-none">
          {`${value.toFixed(1)}${unit}`}
        </p>
        <p className="mt-1.5 text-sm capitalize opacity-70">
          {label}
          {inBand !== undefined && (
            <span className="ml-1.5">
              {inBand ? '· in range' : '· outside range'}
            </span>
          )}
        </p>
      </figcaption>
    </figure>
  );
}

/**
 * Repetitions as marks rather than as a bar.
 *
 * A patient mid-set wants to know how many are left, and counting objects is
 * faster than estimating a proportion. Each mark animates once as it fills:
 * the filled and empty marks carry different React keys, so the browser mounts
 * a new node exactly when a repetition is credited and the entrance plays once
 * instead of on every frame the socket delivers.
 *
 * Above forty marks the ticks would be thinner than the gaps between them, so
 * the component falls back to a single bar. The threshold is about legibility,
 * not about a preference for bars.
 */
export function TallyTrack({
  count,
  target,
  label,
  className = '',
}: {
  count: number;
  target: number;
  label: string;
  className?: string;
}) {
  const safeTarget = Math.max(0, target);
  const done = clamp(count, 0, safeTarget);
  const percent = safeTarget > 0 ? (done / safeTarget) * 100 : 0;

  const shared = {
    role: 'progressbar' as const,
    'aria-valuenow': Math.round(done),
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(safeTarget),
    'aria-label': label,
  };

  if (safeTarget === 0 || safeTarget > 40) {
    return (
      <div
        {...shared}
        className={`h-2 w-full overflow-hidden rounded-full bg-current/15 ${className}`}
      >
        <div
          className="h-full rounded-full bg-current transition-[width] duration-300 ease-[cubic-bezier(0.16,0.84,0.44,1)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  }

  return (
    <div {...shared} className={`flex items-end gap-[3px] ${className}`}>
      {Array.from({ length: safeTarget }, (_, index) =>
        index < done ? (
          <span
            key={`filled-${index}`}
            className="animate-tick-in h-4 flex-1 origin-bottom rounded-xs bg-current"
          />
        ) : (
          <span
            key={`empty-${index}`}
            className="h-4 flex-1 rounded-xs bg-current/15"
          />
        ),
      )}
    </div>
  );
}

/**
 * A closing ring, for time that is being banked.
 *
 * `active` drives a slow scale pulse at roughly the rate of a calm breath.
 * Crucially the pulse is REMOVED rather than paused when alignment is lost, so
 * a stopped ring is visibly inert - the same information the written label
 * gives, delivered fast enough to act on while still holding a position.
 */
export function ProgressRing({
  value,
  max,
  active = false,
  size = 132,
  thickness = 9,
  children,
  ariaLabel,
}: {
  value: number;
  max: number;
  active?: boolean;
  size?: number;
  thickness?: number;
  children?: ReactNode;
  ariaLabel: string;
}) {
  const radius = 50 - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = max > 0 ? clamp(value / max, 0, 1) : 0;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-label={ariaLabel}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden="true"
        className={active ? 'animate-breathe' : undefined}
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          className="opacity-15"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          // Rotated so the ring starts at twelve o'clock, where a clock does.
          transform="rotate(-90 50 50)"
          style={{
            transition:
              'stroke-dashoffset var(--dur-base) cubic-bezier(0.16, 0.84, 0.44, 1)',
          }}
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        {children}
      </div>
    </div>
  );
}

/**
 * Camera confidence, as signal strength.
 *
 * Purely decorative and hidden from assistive technology: the percentage and
 * the written label beside it carry the meaning. The bar COUNT is the
 * redundant encoding that makes this readable without colour - four lit bars
 * out of five says the same thing as the green.
 */
export function SignalBars({
  value,
  bars = 5,
  className = '',
}: {
  /** 0 to 1. */
  value: number;
  bars?: number;
  className?: string;
}) {
  const lit = Math.ceil(clamp(value, 0, 1) * bars);

  return (
    <div className={`flex items-end gap-[3px] ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,0.84,0.44,1)] ${
            index < lit ? 'bg-current opacity-100' : 'bg-current opacity-20'
          }`}
          style={{ height: 6 + index * 3 }}
        />
      ))}
    </div>
  );
}

/**
 * A single measured value beside its label, for a row of angles.
 *
 * The value and its unit are one text node on purpose - see the note in
 * Goniometer. The unit is supplied by the caller because a "level" reading is
 * a distance in metres while everything else is an angle in degrees.
 */
export function Measure({
  label,
  value,
  unit,
  className = '',
}: {
  label: string;
  value: number;
  unit: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs capitalize opacity-60">{label}</p>
      <p className="type-measure text-sm font-medium">
        {`${value.toFixed(1)}${unit}`}
      </p>
    </div>
  );
}

/**
 * The range a joint actually travelled, drawn as a range.
 *
 * Replaces "min 42.1° · max 118.4° · mean 82.7°", which asked the reader to
 * build the picture themselves from three numbers joined by dots. A range of
 * motion is a span on a scale, and physiotherapists already read it that way,
 * so the band is drawn against the full 0-180° a joint can occupy and the mean
 * is marked inside it.
 *
 * The numbers stay underneath. The bar makes the shape obvious at a glance;
 * the figures are what gets written into a clinical note.
 */
export function RangeBar({
  label,
  min,
  max,
  mean,
  domainMin = 0,
  domainMax = 180,
}: {
  label: string;
  min: number;
  max: number;
  mean: number;
  domainMin?: number;
  domainMax?: number;
}) {
  const span = domainMax - domainMin || 1;
  const toPercent = (value: number) =>
    clamp(((value - domainMin) / span) * 100, 0, 100);

  const start = toPercent(min);
  const width = Math.max(1.5, toPercent(max) - start);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium capitalize text-ink-800">{label}</p>
        <p className="type-measure text-xs text-ink-500">
          {`${(max - min).toFixed(1)}° of travel`}
        </p>
      </div>

      <div
        className="relative mt-2 h-2.5 rounded-full bg-ink-100"
        role="img"
        aria-label={`${label}: from ${min.toFixed(1)} to ${max.toFixed(1)} degrees, mean ${mean.toFixed(1)} degrees`}
      >
        <div
          className="animate-meter-grow absolute inset-y-0 origin-left rounded-full bg-brand-400"
          style={{ left: `${start}%`, width: `${width}%` }}
        />
        {/* The mean, marked inside the band rather than printed beside it. */}
        <span
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-800"
          style={{ left: `${toPercent(mean)}%` }}
        />
      </div>

      <p className="type-measure mt-1.5 text-xs text-ink-500">
        {`${min.toFixed(1)}° to ${max.toFixed(1)}°, averaging ${mean.toFixed(1)}°`}
      </p>
    </div>
  );
}
