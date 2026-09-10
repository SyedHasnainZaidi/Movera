import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FeedbackBanner,
  HoldCounter,
  MovementReadout,
} from '../src/features/session/SessionHud';
import {
  describeAchievement,
  describePrescription,
  formatSeconds,
} from '../src/lib/prescription';
import type {
  HoldProgress,
  PoseUpdateData,
  SessionSummary,
} from '../src/types/api';

/**
 * Held-position exercises in the UI.
 *
 * The property under test is that nothing anywhere describes a posture session
 * in repetitions. A posture session records zero of them by design, so every
 * screen that assumes repetitions would report a completed exercise as a total
 * failure - "0 / 1 reps", "0% complete", "0 good form".
 */

function hold(overrides: Partial<HoldProgress> = {}): HoldProgress {
  return {
    heldSeconds: 24,
    targetSeconds: 60,
    remainingSeconds: 36,
    progress: 0.4,
    active: true,
    streakSeconds: 8,
    bestStreakSeconds: 12,
    ...overrides,
  };
}

describe('HoldCounter', () => {
  it('shows time held against the prescription', () => {
    render(<HoldCounter hold={hold()} />);
    expect(screen.getByText('24s')).toBeInTheDocument();
    expect(screen.getByText('/ 1m')).toBeInTheDocument();
  });

  it('announces the running total to assistive technology', () => {
    render(<HoldCounter hold={hold()} />);
    expect(screen.getByText('24s')).toHaveAttribute('aria-live', 'polite');

    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '24');
    expect(progress).toHaveAttribute('aria-valuemax', '60');
  });

  it('says in words that the timer is running', () => {
    // Not only a colour: a patient with colour-vision deficiency and a screen
    // reader user both have to know whether the clock is counting.
    render(<HoldCounter hold={hold({ active: true })} />);
    expect(screen.getByText('Holding')).toBeInTheDocument();
  });

  it('explains WHY the timer stopped rather than just stopping', () => {
    render(<HoldCounter hold={hold({ active: false })} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(
      screen.getByText(/timer runs only while your posture is correct/i),
    ).toBeInTheDocument();
  });

  it('states that the hold need not be unbroken', () => {
    // Without this a patient who drifts will assume they have to start over.
    render(<HoldCounter hold={hold()} />);
    expect(
      screen.getByText(/do not have to hold it all in one go/i),
    ).toBeInTheDocument();
  });

  it('says the session is ending once the target is met', () => {
    render(
      <HoldCounter hold={hold({ heldSeconds: 60, remainingSeconds: 0 })} />,
    );
    expect(screen.getByText(/Target reached/i)).toBeInTheDocument();
    expect(screen.getByText(/finishing your session/i)).toBeInTheDocument();
  });

  it('renders before the first frame arrives', () => {
    render(<HoldCounter hold={null} />);
    expect(screen.getByText('0s')).toBeInTheDocument();
  });
});

describe('MovementReadout in a held session', () => {
  function poseFixture(): PoseUpdateData {
    return {
      sessionId: 's1',
      exercise: 'static-posture',
      frameIndex: 12,
      personDetected: true,
      peopleDetected: 1,
      trackingValid: true,
      confidence: 0.9,
      landmarks: [],
      missingLandmarks: [],
      angles: { spine: 174.2 },
      movementState: 'HOLDING',
      stateHeldMs: 0,
      goalType: 'HOLD',
      rep: {
        completed: false,
        count: 0,
        targetCount: 1,
        currentSet: 1,
        targetSets: 1,
      },
      hold: hold(),
      posture: { correct: true, score: 96 },
      errors: [],
      latencyMs: { decode: 1, inference: 140, analysis: 1, total: 142 },
      timestamp: new Date().toISOString(),
    };
  }

  it('names the held state in words, not as a raw enum', () => {
    render(<MovementReadout pose={poseFixture()} />);
    expect(screen.getByText('Correctly aligned')).toBeInTheDocument();
    expect(screen.queryByText('HOLDING')).not.toBeInTheDocument();
  });
});

describe('FeedbackBanner encouragement', () => {
  it('tells a held session to stay still, not to keep going', () => {
    render(
      <FeedbackBanner
        error={null}
        postureCorrect
        hasPose
        goalType="HOLD"
      />,
    );
    expect(screen.getByText('Good alignment - hold it there.')).toBeInTheDocument();
  });

  it('still says keep going for a repetition exercise', () => {
    render(
      <FeedbackBanner error={null} postureCorrect hasPose goalType="REPS" />,
    );
    expect(screen.getByText('Good form - keep going.')).toBeInTheDocument();
  });
});

describe('formatSeconds', () => {
  it('uses plain seconds below a minute', () => {
    expect(formatSeconds(45)).toBe('45s');
  });

  it('pads so durations line up when listed together', () => {
    expect(formatSeconds(65)).toBe('1m 05s');
  });

  it('drops a zero seconds component', () => {
    expect(formatSeconds(180)).toBe('3m');
  });
});

describe('describePrescription', () => {
  it('describes a repetition assignment in sets and reps', () => {
    expect(
      describePrescription({
        goalType: 'REPS',
        holdSeconds: null,
        targetSets: 3,
        repsPerSet: 10,
        targetTotalReps: 30,
      }),
    ).toBe('3 × 10 = 30 reps');
  });

  it('describes a held assignment in time, never in reps', () => {
    // The stored row carries targetSets 1 and repsPerSet 1 because the columns
    // are NOT NULL. Printing them would read as "1 × 1 = 1 rep".
    const text = describePrescription({
      goalType: 'HOLD',
      holdSeconds: 60,
      targetSets: 1,
      repsPerSet: 1,
      targetTotalReps: 1,
    });

    expect(text).toBe('hold 1m of correct alignment');
    expect(text).not.toMatch(/rep/i);
  });

  it('copes with a hold assignment that has no duration set', () => {
    expect(
      describePrescription({
        goalType: 'HOLD',
        holdSeconds: null,
        targetSets: 1,
        repsPerSet: 1,
        targetTotalReps: 1,
      }),
    ).toBe('hold correct alignment');
  });
});

describe('describeAchievement', () => {
  function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
      id: 's1',
      exercise: { slug: 'squat', name: 'Squat' },
      startedAt: '2026-08-30T10:00:00.000Z',
      endedAt: '2026-08-30T10:05:00.000Z',
      durationSec: 300,
      totalReps: 24,
      targetTotalReps: 30,
      correctReps: 20,
      incorrectReps: 4,
      performanceScore: 82,
      ...overrides,
    };
  }

  it('reports a repetition session in repetitions', () => {
    expect(describeAchievement(session({ goalType: 'REPS' }))).toBe(
      '24 / 30 reps',
    );
  });

  it('reports a held session in time held', () => {
    // Without this the history row reads "0 / 1 reps" for a session the
    // patient completed.
    const text = describeAchievement(
      session({
        goalType: 'HOLD',
        totalReps: 0,
        targetTotalReps: 1,
        heldSec: 52,
        targetHoldSec: 60,
      }),
    );

    expect(text).toBe('52s / 1m held');
    expect(text).not.toMatch(/rep/i);
  });

  it('falls back to repetitions when the goal type is unknown', () => {
    // Older responses predate the field; they were all repetition sessions.
    expect(describeAchievement(session({ goalType: undefined }))).toBe(
      '24 / 30 reps',
    );
  });
});
