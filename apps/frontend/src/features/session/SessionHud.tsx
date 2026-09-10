import type { ReactNode } from 'react';
import { formatSeconds } from '../../lib/prescription';
import { Badge } from '../../components/ui';
import {
  Goniometer,
  Measure,
  ProgressRing,
  SignalBars,
  TallyTrack,
} from '../../components/instruments';
import { useEmphasis } from '../../components/motion';
import type {
  ExerciseGoalType,
  HoldProgress,
  PoseError,
  PoseUpdateData,
} from '../../types/api';

/**
 * Live readouts shown beside the camera.
 *
 * The guiding rule is that the patient should never have to guess why the
 * counter stopped. Every state that halts repetition counting - no person,
 * partial body, low confidence, a second person in frame - is named
 * explicitly, with the fix stated in plain language.
 *
 * These panels sit on the dark console rather than on a white page, for two
 * practical reasons rather than for atmosphere: a dark screen throws far less
 * light back at a patient who is standing two or three metres away trying to
 * be seen, and it leaves the camera view as the brightest object on screen,
 * which is where their attention belongs.
 *
 * Where a number is animated, the animation is on the CONTAINER and never on
 * the text. The digits themselves always print the value the analysis
 * produced, on the frame it produced it.
 */

/** One instrument on the console. */
function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-panel border border-white/10 bg-white/[0.04] px-5 py-4 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-stage-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RepCounter({
  count,
  target,
  currentSet,
  targetSets,
}: {
  count: number;
  target: number;
  currentSet: number;
  targetSets: number;
}) {
  const remaining = Math.max(0, target - count);

  // Fires only when the count actually changes, so arriving on the screen
  // mid-session does not throw a repetition the patient did not just perform.
  const figureRef = useEmphasis<HTMLParagraphElement>(count);

  return (
    <Panel
      title="Repetitions"
      action={
        <Badge tone="console">
          Set {currentSet} of {targetSets}
        </Badge>
      }
    >
      <p ref={figureRef} className="mt-2 flex items-baseline gap-2">
        <span
          className="type-display type-measure text-[52px] leading-none text-white"
          aria-live="polite"
          aria-atomic="true"
        >
          {count}
        </span>
        <span className="type-measure text-lg text-stage-400">/ {target}</span>
      </p>

      {/*
        Marks rather than a bar. A patient part-way through a set wants to know
        how many are left, and counting objects answers that faster than
        judging the length of a fill.
      */}
      <TallyTrack
        count={count}
        target={target}
        label="Session progress"
        className="mt-4 text-brand-300"
      />

      <p className="mt-3 text-xs text-stage-400">
        {remaining === 0
          ? 'Target reached - you can finish whenever you are ready.'
          : `${remaining} repetition${remaining === 1 ? '' : 's'} remaining`}
      </p>
    </Panel>
  );
}

/**
 * Time spent correctly aligned, for exercises with no repetition to count.
 *
 * Shown INSTEAD of RepCounter, never beside it. A postural drill has no
 * repetitions, and a counter stuck on zero next to a working timer would read
 * as a broken counter rather than as an exercise measured differently.
 *
 * The distinction between accumulated time and the current unbroken stretch is
 * made explicit, because the timer visibly stops when the patient drifts out
 * of alignment - and a patient who is not told why will assume it is faulty.
 *
 * The ring breathes while the hold is credited and goes completely still the
 * moment it is not. That stillness is the fastest available signal: a patient
 * holding a plank cannot read a sentence, but they can see a moving thing stop
 * out of the corner of their eye.
 */
export function HoldCounter({ hold }: { hold: HoldProgress | null }) {
  const held = hold?.heldSeconds ?? 0;
  const target = hold?.targetSeconds ?? 0;
  const active = hold?.active ?? false;

  return (
    <Panel
      title="Time held"
      action={
        <Badge tone={active ? 'good' : 'caution'}>
          {active ? 'Holding' : 'Paused'}
        </Badge>
      }
    >
      <div className="mt-3 flex justify-center">
        {/*
          The ring takes the tone of the state it is reporting, so colour,
          movement and the written badge all say the same thing at once. A
          patient in a plank can act on the colour change before they could
          read the word.
        */}
        <div
          className={`relative inline-grid place-items-center ${
            active ? 'text-good-300' : 'text-caution-300'
          }`}
        >
          {/*
            The ring is a sibling of the readout rather than its parent. ARIA
            treats the children of a progressbar as presentational, so a time
            nested inside one would be announced by nothing at all - which is
            the announcement a patient holding a position needs most.
          */}
          <ProgressRing
            value={held}
            max={target}
            active={active}
            size={158}
            ariaLabel="Hold progress"
          />

          <div className="absolute inset-0 grid place-items-center">
            <p className="flex flex-col items-center">
              <span
                className="type-display type-measure text-[34px] leading-none text-white"
                aria-live="polite"
                aria-atomic="true"
              >
                {formatSeconds(held)}
              </span>
              {target > 0 && (
                <span className="type-measure mt-1 text-sm text-stage-400">
                  / {formatSeconds(target)}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-stage-400">
        {target > 0 && held >= target
          ? 'Target reached - finishing your session.'
          : active
            ? `Holding well - ${formatSeconds(hold?.streakSeconds ?? 0)} in this stretch.`
            : 'The timer runs only while your posture is correct. Follow the guidance above.'}
      </p>

      {target > 0 && held < target && (
        <p className="mt-1 text-xs text-stage-400">
          {formatSeconds(target - held)} remaining · you do not have to hold it
          all in one go
        </p>
      )}
    </Panel>
  );
}

const STATE_LABELS: Record<string, string> = {
  IDLE: 'Waiting for movement',
  UP: 'Start position',
  GOING_DOWN: 'Moving',
  DOWN: 'Hold',
  GOING_UP: 'Returning',
  HOLDING: 'Correctly aligned',
};

/** A "level" reading is a distance; everything else the service emits is an angle. */
const unitFor = (name: string) =>
  name.toLowerCase().includes('level') ? ' m' : '°';

const humanise = (name: string) =>
  name.replace(/([A-Z])/g, ' $1').toLowerCase();

export function MovementReadout({ pose }: { pose: PoseUpdateData | null }) {
  const state = pose?.movementState ?? 'IDLE';
  const angles = Object.entries(pose?.angles ?? {}).filter(
    ([name]) => !name.startsWith('left') && !name.startsWith('right'),
  );

  // The first aggregate angle is the one the exercise turns on - a knee for a
  // squat, a spine for posture - so it gets the dial and the rest get a line
  // each. Showing every angle as a dial would rank none of them.
  const [primary, ...secondary] = angles;

  return (
    <Panel title="Movement">
      <p className="mt-1 text-lg font-semibold text-white">
        {STATE_LABELS[state] ?? state}
      </p>

      {primary && (
        <div className="mt-3 flex justify-center text-brand-300">
          <Goniometer
            value={primary[1]}
            label={humanise(primary[0])}
            unit={unitFor(primary[0])}
            size={186}
          />
        </div>
      )}

      {secondary.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/10 pt-3 text-stage-200">
          {secondary.map(([name, value]) => (
            <Measure
              key={name}
              label={humanise(name)}
              value={value}
              unit={unitFor(name)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function TrackingQuality({ pose }: { pose: PoseUpdateData | null }) {
  if (!pose) {
    return (
      <Panel title="Tracking">
        <p className="mt-1 text-sm text-stage-400">
          Waiting for the first frame…
        </p>
      </Panel>
    );
  }

  const percent = Math.round(pose.confidence * 100);
  const tone = !pose.personDetected
    ? 'problem'
    : !pose.trackingValid
      ? 'caution'
      : 'good';
  const label = !pose.personDetected
    ? 'No one detected'
    : !pose.trackingValid
      ? 'Partially visible'
      : 'Tracking well';

  const barColour =
    tone === 'good'
      ? 'text-good-300'
      : tone === 'caution'
        ? 'text-caution-300'
        : 'text-problem-300';

  return (
    <Panel title="Tracking" action={<Badge tone={tone}>{label}</Badge>}>
      {/*
        Signal bars, because everyone already knows what they mean. The COUNT
        of lit bars is the redundant encoding that carries the reading without
        colour - four of five says the same thing as the green.
      */}
      <div className="mt-3 flex items-center gap-3">
        <SignalBars value={pose.confidence} className={barColour} />
        <span className="type-measure text-sm font-medium text-stage-100">
          {percent}%
        </span>
      </div>

      {/* Named explicitly so nobody reads this as an accuracy score. */}
      <p className="mt-2 text-xs text-stage-400">
        How clearly the camera can see you - not a measure of exercise
        correctness.
      </p>

      {pose.peopleDetected > 1 && (
        <p className="mt-2 text-xs font-medium text-caution-300">
          {pose.peopleDetected} people detected. Only the patient should be in
          frame.
        </p>
      )}

      {pose.missingLandmarks.length > 0 && (
        <p className="mt-2 text-xs text-problem-300">
          Cannot see:{' '}
          {pose.missingLandmarks
            .map((name) => name.replace(/_/g, ' '))
            .join(', ')}
        </p>
      )}
    </Panel>
  );
}

/**
 * One corrective cue at a time.
 *
 * The pose service can emit several rule violations in the same frame at
 * 10 fps. Showing all of them, refreshed ten times a second, is unreadable and
 * stressful. The session page debounces this to the single most severe message
 * and holds it briefly, so the patient gets one clear instruction.
 *
 * The cue is re-keyed on its text so that a REPLACEMENT instruction animates
 * in while a repeated one stays perfectly still. Movement is what draws a
 * patient's eye back to the words, and it should only happen when the words
 * have changed.
 */
export function FeedbackBanner({
  error,
  postureCorrect,
  hasPose,
  goalType = 'REPS',
}: {
  error: PoseError | null;
  postureCorrect: boolean;
  hasPose: boolean;
  /**
   * Changes the encouragement, not the corrections. "Keep going" is the wrong
   * instruction for an exercise whose whole task is to stay still.
   */
  goalType?: ExerciseGoalType;
}) {
  if (!hasPose) {
    return (
      <div className="rounded-panel border border-white/10 bg-white/[0.04] px-5 py-4">
        <p className="text-sm text-stage-300">
          Get into position to begin. Your feedback will appear here.
        </p>
      </div>
    );
  }

  if (!error) {
    const message =
      goalType === 'HOLD'
        ? 'Good alignment - hold it there.'
        : postureCorrect
          ? 'Good form - keep going.'
          : 'Keep going.';
    return (
      <div
        key={message}
        className="animate-cue-in flex items-center gap-3 rounded-panel border border-good-300/25 bg-good-300/10 px-5 py-4"
        role="status"
        aria-live="polite"
      >
        <CueIcon tone="good" />
        <p className="text-sm font-medium text-good-300">{message}</p>
      </div>
    );
  }

  const tone =
    error.severity === 'critical'
      ? 'border-problem-300/30 bg-problem-300/10 text-problem-300'
      : error.severity === 'warning'
        ? 'border-caution-300/30 bg-caution-300/10 text-caution-300'
        : 'border-white/10 bg-white/[0.06] text-stage-200';

  return (
    <div
      key={error.message}
      className={`animate-cue-in flex items-start gap-3 rounded-panel border px-5 py-4 ${tone}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CueIcon
        tone={error.severity === 'critical' ? 'problem' : 'caution'}
      />
      <div>
        <p className="text-sm font-medium">{error.message}</p>
        {error.observed !== null && error.observed !== undefined && (
          <p className="type-measure mt-1 text-xs opacity-80">
            Measured {error.observed.toFixed(1)}
            {'°'}
            {error.expected?.max !== undefined &&
              ` · target below ${error.expected.max}°`}
            {error.expected?.min !== undefined &&
              ` · target above ${error.expected.min}°`}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The shape beside a cue.
 *
 * Three different silhouettes, not three colours of the same one: a patient
 * with colour-vision deficiency has to be able to tell praise from a warning
 * across a room, and at that distance shape carries further than hue.
 */
function CueIcon({ tone }: { tone: 'good' | 'caution' | 'problem' }) {
  const paths = {
    good: 'M4 10.5 L 8.2 14.5 L 16 5.5',
    caution: 'M10 3 L 18 16.5 H 2 Z M10 8 v 4 M10 14 v 0.6',
    problem: 'M10 2.5 v 9 M10 15 v 0.8',
  };

  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      {tone === 'problem' && (
        <circle cx="10" cy="10" r="8.2" strokeWidth={1.6} opacity={0.55} />
      )}
      <path d={paths[tone]} />
    </svg>
  );
}
