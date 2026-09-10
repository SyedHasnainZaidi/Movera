import type { Assignment, ExerciseGoalType } from '../types/api';

/**
 * Describing a prescription in words.
 *
 * Every screen that shows an assignment or a past session used to print
 * "3 × 10 = 30 reps". That is wrong for a held-position exercise, which has no
 * repetitions: a posture assignment would read "1 × 1 = 1 rep", and a finished
 * posture session would read "0 of 1 reps" - describing a completed exercise
 * as a total failure.
 *
 * These live in one module so the phrasing cannot drift between the patient's
 * dashboard, the therapist's caseload and the exercise library. They are the
 * only place in the frontend allowed to decide what a goal type means.
 */

/**
 * "45s" / "1m 05s". THE duration formatter for the whole frontend.
 *
 * Seconds are what a patient reads on the live timer, so the report and the
 * history rows have to agree with it exactly - a session shown as "1m 05s"
 * live and "65 seconds" afterwards invites the reader to wonder which is
 * right.
 */
export function formatSeconds(value: number): string {
  const whole = Math.max(0, Math.round(value));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0
    ? `${minutes}m`
    : `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/**
 * What a therapist prescribed, for an assignment row.
 *
 * e.g. "3 × 10 = 30 reps", or "hold 1m of correct alignment".
 */
export function describePrescription(
  assignment: Pick<
    Assignment,
    'goalType' | 'holdSeconds' | 'targetSets' | 'repsPerSet' | 'targetTotalReps'
  >,
): string {
  if (assignment.goalType === 'HOLD') {
    const target = assignment.holdSeconds ?? 0;
    return target > 0
      ? `hold ${formatSeconds(target)} of correct alignment`
      : 'hold correct alignment';
  }
  return `${assignment.targetSets} × ${assignment.repsPerSet} = ${assignment.targetTotalReps} reps`;
}

/**
 * What a patient actually achieved, for a history row.
 *
 * e.g. "24 / 30 reps", or "52s / 1m held".
 *
 * Takes the four fields it reads rather than a whole SessionSummary, because
 * the same row is rendered from three different endpoint shapes - the session
 * list, the patient dashboard and the therapist caseload - and only these are
 * common to all of them. One function means one phrasing everywhere.
 */
export interface SessionGoalFields {
  goalType?: ExerciseGoalType | null;
  totalReps: number;
  targetTotalReps: number;
  heldSec?: number | null;
  targetHoldSec?: number | null;
}

export function describeAchievement(session: SessionGoalFields): string {
  if (session.goalType === 'HOLD') {
    const held = formatSeconds(session.heldSec ?? 0);
    const target = session.targetHoldSec ?? 0;
    return target > 0 ? `${held} / ${formatSeconds(target)} held` : `${held} held`;
  }
  return `${session.totalReps} / ${session.targetTotalReps} reps`;
}

/** The unit a goal is counted in, for column headers and short labels. */
export function goalNoun(goalType: Assignment['goalType']): string {
  return goalType === 'HOLD' ? 'time held' : 'repetitions';
}
