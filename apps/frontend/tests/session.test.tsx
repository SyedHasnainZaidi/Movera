import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FeedbackBanner,
  MovementReadout,
  RepCounter,
  TrackingQuality,
} from '../src/features/session/SessionHud';
import type { PoseError, PoseUpdateData } from '../src/types/api';

/**
 * Live-session UI.
 *
 * The property under test throughout is that a patient is never left guessing.
 * Every state that stops repetition counting must SAY so, in words - not merely
 * change a colour, which is invisible to a patient with colour-vision
 * deficiency and meaningless to a screen reader.
 */

function poseFixture(overrides: Partial<PoseUpdateData> = {}): PoseUpdateData {
  return {
    sessionId: 's1',
    exercise: 'squat',
    frameIndex: 42,
    personDetected: true,
    peopleDetected: 1,
    trackingValid: true,
    confidence: 0.93,
    landmarks: [],
    missingLandmarks: [],
    angles: { knee: 96.4, trunkLean: 12.1 },
    movementState: 'DOWN',
    stateHeldMs: 340,
    goalType: 'REPS',
    rep: {
      completed: false,
      count: 6,
      targetCount: 30,
      currentSet: 1,
      targetSets: 3,
    },
    hold: null,
    posture: { correct: true, score: 88 },
    errors: [],
    latencyMs: { decode: 1.5, inference: 62, analysis: 0.8, total: 64.3 },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('RepCounter', () => {
  it('shows progress against the prescription', () => {
    render(
      <RepCounter count={6} target={30} currentSet={1} targetSets={3} />,
    );
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('/ 30')).toBeInTheDocument();
    expect(screen.getByText('Set 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('24 repetitions remaining')).toBeInTheDocument();
  });

  it('announces the count to assistive technology', () => {
    render(
      <RepCounter count={6} target={30} currentSet={1} targetSets={3} />,
    );
    // aria-live so a screen-reader user hears each repetition land.
    expect(screen.getByText('6')).toHaveAttribute('aria-live', 'polite');

    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '6');
    expect(progress).toHaveAttribute('aria-valuemax', '30');
  });

  it('uses singular wording for one remaining repetition', () => {
    render(
      <RepCounter count={29} target={30} currentSet={3} targetSets={3} />,
    );
    expect(screen.getByText('1 repetition remaining')).toBeInTheDocument();
  });

  it('says the target is reached rather than showing a negative count', () => {
    render(
      <RepCounter count={30} target={30} currentSet={3} targetSets={3} />,
    );
    expect(screen.getByText(/Target reached/)).toBeInTheDocument();
  });

  it('never displays a set beyond the prescription', () => {
    // currentSet is clamped upstream; this guards the display contract.
    render(
      <RepCounter count={30} target={30} currentSet={3} targetSets={3} />,
    );
    expect(screen.getByText('Set 3 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Set 4 of 3')).not.toBeInTheDocument();
  });
});

describe('TrackingQuality', () => {
  it('waits visibly before the first frame arrives', () => {
    render(<TrackingQuality pose={null} />);
    expect(screen.getByText(/Waiting for the first frame/)).toBeInTheDocument();
  });

  it('reports good tracking in words, not only colour', () => {
    render(<TrackingQuality pose={poseFixture()} />);
    expect(screen.getByText('Tracking well')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
  });

  it('states plainly that confidence is not an accuracy score', () => {
    render(<TrackingQuality pose={poseFixture()} />);
    expect(
      screen.getByText(/not a measure of exercise correctness/i),
    ).toBeInTheDocument();
  });

  it('names the landmarks it cannot see', () => {
    render(
      <TrackingQuality
        pose={poseFixture({
          trackingValid: false,
          confidence: 0.4,
          missingLandmarks: ['left_ankle', 'right_ankle'],
        })}
      />,
    );
    expect(screen.getByText('Partially visible')).toBeInTheDocument();
    expect(screen.getByText(/left ankle, right ankle/)).toBeInTheDocument();
  });

  it('warns when more than one person is in frame', () => {
    render(
      <TrackingQuality pose={poseFixture({ peopleDetected: 2 })} />,
    );
    expect(
      screen.getByText(/Only the patient should be in frame/),
    ).toBeInTheDocument();
  });

  it('says when nobody is detected', () => {
    render(
      <TrackingQuality
        pose={poseFixture({
          personDetected: false,
          trackingValid: false,
          confidence: 0,
        })}
      />,
    );
    expect(screen.getByText('No one detected')).toBeInTheDocument();
  });
});

describe('FeedbackBanner', () => {
  it('prompts the patient before any pose arrives', () => {
    render(
      <FeedbackBanner error={null} postureCorrect={false} hasPose={false} />,
    );
    expect(screen.getByText(/Get into position/)).toBeInTheDocument();
  });

  it('confirms good form when no rule fired', () => {
    render(
      <FeedbackBanner error={null} postureCorrect hasPose />,
    );
    expect(screen.getByText('Good form - keep going.')).toBeInTheDocument();
  });

  it('shows the corrective cue with the measured value', () => {
    const error: PoseError = {
      code: 'TRUNK_LEAN',
      severity: 'warning',
      message: 'Keep your upper body more upright.',
      joint: 'trunk',
      observed: 52.4,
      expected: { max: 45 },
    };
    render(<FeedbackBanner error={error} postureCorrect={false} hasPose />);

    expect(
      screen.getByText('Keep your upper body more upright.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/52.4/)).toBeInTheDocument();
    expect(screen.getByText(/target below 45/)).toBeInTheDocument();
  });

  it('publishes feedback to a live region so it is announced', () => {
    const error: PoseError = {
      code: 'PARTIAL_BODY_VISIBLE',
      severity: 'critical',
      message: 'Move back so your full body is visible.',
    };
    render(<FeedbackBanner error={error} postureCorrect={false} hasPose />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Move back so your full body is visible.');
  });
});

describe('MovementReadout', () => {
  it('translates the state machine into plain language', () => {
    render(<MovementReadout pose={poseFixture()} />);
    // "DOWN" means the peak of the movement, which is not obvious wording.
    expect(screen.getByText('Hold')).toBeInTheDocument();
  });

  it('shows aggregate angles with units', () => {
    render(<MovementReadout pose={poseFixture()} />);
    expect(screen.getByText('96.4°')).toBeInTheDocument();
    expect(screen.getByText('12.1°')).toBeInTheDocument();
  });

  it('hides per-side angles to keep the readout scannable', () => {
    render(
      <MovementReadout
        pose={poseFixture({
          angles: { knee: 96.4, leftKnee: 95.1, rightKnee: 97.7 },
        })}
      />,
    );
    expect(screen.getByText('96.4°')).toBeInTheDocument();
    expect(screen.queryByText('95.1°')).not.toBeInTheDocument();
  });

  it('falls back to idle before any pose', () => {
    render(<MovementReadout pose={null} />);
    expect(screen.getByText('Waiting for movement')).toBeInTheDocument();
  });
});
