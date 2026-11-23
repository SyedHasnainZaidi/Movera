import type { BodySide, ExerciseSideMode } from '../types/api';

/**
 * Wording for side-specific exercises.
 *
 * One module, so the session screen, the history rows, the report and the
 * therapist's views cannot describe the same session differently. Left and
 * right are always the PATIENT'S left and right - the analysis frames are not
 * mirrored, so this matches what the pose service measured.
 */

export const BODY_SIDES: BodySide[] = ['LEFT', 'RIGHT'];

export function isSided(mode: ExerciseSideMode | null | undefined): boolean {
  return mode !== undefined && mode !== null && mode !== 'NONE';
}

/** "Left" / "Right". */
export function sideLabel(side: BodySide): string {
  return side === 'LEFT' ? 'Left' : 'Right';
}

/** "Knee Extension (left)" for a sided session; the bare name otherwise. */
export function withSide(name: string, side: BodySide | null | undefined): string {
  return side ? `${name} (${side.toLowerCase()})` : name;
}

/** The question asked before a side-specific session starts. */
export function sideQuestion(mode: ExerciseSideMode): string {
  switch (mode) {
    case 'DIRECTION':
      return 'Which way will you bend?';
    case 'FACING':
      return 'Which side of your body will face the camera?';
    default:
      return 'Which side are you exercising?';
  }
}

/** Button text for one side. */
export function sideOptionLabel(mode: ExerciseSideMode, side: BodySide): string {
  const word = sideLabel(side);
  switch (mode) {
    case 'DIRECTION':
      return `Towards the ${word.toLowerCase()}`;
    case 'FACING':
      return `${word} side to camera`;
    default:
      return `${word} side`;
  }
}

/** One line explaining why the choice matters, under the buttons. */
export function sideExplanation(mode: ExerciseSideMode): string {
  switch (mode) {
    case 'DIRECTION':
      return 'Each direction is its own session with its own count. Do the other direction as a separate session.';
    case 'FACING':
      return 'The camera measures the side nearer to it. Stand with that side towards the camera.';
    default:
      return 'Each side is its own session with its own count - finishing one side does not complete the other. Stand with this side nearer the camera.';
  }
}
