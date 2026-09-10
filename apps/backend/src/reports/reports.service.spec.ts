import { Severity } from '@prisma/client';
import {
  aggregateAngles,
  aggregateErrors,
  buildHoldSummary,
  buildSummary,
  computeCompletionRatio,
  formatDuration,
  parseHoldSummary,
} from './reports.service';

/**
 * The report aggregation functions are pure, so they are tested directly
 * without a database. These are the numbers a patient and a therapist read,
 * so their arithmetic is verified rather than assumed.
 */

describe('aggregateAngles', () => {
  it('takes the extreme min and max across repetitions', () => {
    const result = aggregateAngles([
      { knee: { min: 95, max: 170, mean: 130 } },
      { knee: { min: 88, max: 175, mean: 128 } },
      { knee: { min: 101, max: 168, mean: 134 } },
    ]);

    // Deepest flexion and fullest extension reached at ANY point in the
    // session - not an average of the per-rep extremes.
    expect(result.knee.min).toBe(88);
    expect(result.knee.max).toBe(175);
  });

  it('averages the per-repetition means', () => {
    const result = aggregateAngles([
      { knee: { min: 90, max: 170, mean: 120 } },
      { knee: { min: 90, max: 170, mean: 140 } },
    ]);
    expect(result.knee.mean).toBe(130);
  });

  it('handles several angles independently', () => {
    const result = aggregateAngles([
      {
        knee: { min: 95, max: 170, mean: 130 },
        trunkLean: { min: 5, max: 30, mean: 18 },
      },
    ]);
    expect(Object.keys(result).sort()).toEqual(['knee', 'trunkLean']);
    expect(result.trunkLean.max).toBe(30);
  });

  it('returns an empty object for no repetitions', () => {
    expect(aggregateAngles([])).toEqual({});
  });

  it('ignores malformed entries rather than throwing', () => {
    const result = aggregateAngles([
      null,
      'not an object',
      { knee: 'nonsense' },
      { knee: { min: 90 } }, // incomplete
      { knee: { min: 95, max: 170, mean: 130 } },
    ] as never[]);

    // Only the one well-formed record survives.
    expect(result.knee).toEqual({ min: 95, max: 170, mean: 130 });
  });

  it('rounds to one decimal place', () => {
    const result = aggregateAngles([
      { knee: { min: 95.44, max: 170.16, mean: 130.333 } },
    ]);
    expect(result.knee.min).toBe(95.4);
    expect(result.knee.max).toBe(170.2);
    expect(result.knee.mean).toBe(130.3);
  });
});

describe('aggregateErrors', () => {
  it('sums occurrences and counts affected repetitions separately', () => {
    const result = aggregateErrors([
      { code: 'TRUNK_LEAN', severity: Severity.WARNING, occurrences: 4 },
      { code: 'TRUNK_LEAN', severity: Severity.WARNING, occurrences: 6 },
      { code: 'INSUFFICIENT_DEPTH', severity: Severity.WARNING, occurrences: 3 },
    ]);

    const lean = result.find((e) => e.code === 'TRUNK_LEAN');
    expect(lean?.occurrences).toBe(10); // total frames across the session
    expect(lean?.repsAffected).toBe(2); // number of repetitions involved
  });

  it('sorts by how many repetitions were affected', () => {
    const result = aggregateErrors([
      { code: 'RARE', severity: Severity.WARNING, occurrences: 99 },
      { code: 'COMMON', severity: Severity.WARNING, occurrences: 1 },
      { code: 'COMMON', severity: Severity.WARNING, occurrences: 1 },
      { code: 'COMMON', severity: Severity.WARNING, occurrences: 1 },
    ]);

    // A fault seen in three separate repetitions matters more than one that
    // fired many times inside a single repetition.
    expect(result[0].code).toBe('COMMON');
    expect(result[1].code).toBe('RARE');
  });

  it('returns an empty array when nothing was detected', () => {
    expect(aggregateErrors([])).toEqual([]);
  });
});

describe('buildSummary', () => {
  it('reports completion, correctness and the leading issue', () => {
    const summary = buildSummary({
      exerciseName: 'Bodyweight Squat',
      totalReps: 24,
      targetTotalReps: 30,
      correctReps: 19,
      performanceScore: 82.4,
      completionRatio: 80,
      topError: 'TRUNK_LEAN',
    });

    expect(summary).toContain('24 of 30');
    expect(summary).toContain('80%');
    expect(summary).toContain('19 repetitions');
    expect(summary).toContain('82.4/100');
    expect(summary).toContain('trunk lean');
  });

  it('says so plainly when no issues were found', () => {
    const summary = buildSummary({
      exerciseName: 'Bicep Curl',
      totalReps: 12,
      targetTotalReps: 12,
      correctReps: 12,
      performanceScore: 96,
      completionRatio: 100,
    });
    expect(summary).toContain('No recurring form issues');
  });

  it('explains an empty session instead of showing zeros', () => {
    const summary = buildSummary({
      exerciseName: 'Bodyweight Squat',
      totalReps: 0,
      targetTotalReps: 30,
      correctReps: 0,
      performanceScore: 0,
      completionRatio: 0,
    });
    // A patient seeing 0/30 needs to know WHY, not just the number.
    expect(summary).toContain('camera could not see');
  });

  it('uses singular wording for one repetition', () => {
    const summary = buildSummary({
      exerciseName: 'Squat',
      totalReps: 1,
      targetTotalReps: 30,
      correctReps: 1,
      performanceScore: 90,
      completionRatio: 3.3,
    });
    expect(summary).toContain('1 repetition met');
    expect(summary).not.toContain('1 repetitions');
  });
});

// ---------------------------------------------------------------------------
// Held-position sessions
//
// A HOLD session records no repetitions at all, so every figure in its report
// comes from a different place than a repetition session's. These are the
// functions that make that difference, and getting them wrong would describe a
// completed posture session as a total failure.
// ---------------------------------------------------------------------------

describe('computeCompletionRatio', () => {
  it('measures a repetition session against its repetitions', () => {
    expect(
      computeCompletionRatio({
        goalType: 'REPS',
        totalReps: 24,
        targetTotalReps: 30,
        heldSec: null,
        targetHoldSec: null,
      }),
    ).toBe(80);
  });

  it('measures a held session against its SECONDS, not its reps', () => {
    // The bug this exists to prevent: a posture session stores targetTotalReps
    // = 1 and totalReps = 0, so the repetition formula would report 0% for a
    // session the patient actually completed.
    expect(
      computeCompletionRatio({
        goalType: 'HOLD',
        totalReps: 0,
        targetTotalReps: 1,
        heldSec: 45,
        targetHoldSec: 60,
      }),
    ).toBe(75);
  });

  it('does not divide by a missing hold target', () => {
    expect(
      computeCompletionRatio({
        goalType: 'HOLD',
        totalReps: 0,
        targetTotalReps: 1,
        heldSec: 45,
        targetHoldSec: null,
      }),
    ).toBe(0);
  });
});

describe('formatDuration', () => {
  it('uses plain seconds below a minute', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('pads the seconds so durations line up when listed', () => {
    expect(formatDuration(65)).toBe('1m 05s');
  });

  it('drops the seconds when there are none', () => {
    expect(formatDuration(120)).toBe('2m');
  });

  it('never renders a negative duration', () => {
    expect(formatDuration(-5)).toBe('0s');
  });
});

describe('parseHoldSummary', () => {
  it('reads a well-formed snapshot', () => {
    const parsed = parseHoldSummary({
      heldSec: 61.5,
      bestStreakSec: 22.25,
      analysedFrames: 430,
      meanScore: 87.4,
      meanConfidence: 0.91,
      angleStats: { spine: { min: 150, max: 179, mean: 171 } },
      errors: [
        { code: 'SPINE_ALIGNMENT', severity: Severity.WARNING, occurrences: 40 },
      ],
    });

    expect(parsed.heldSec).toBe(61.5);
    expect(parsed.bestStreakSec).toBe(22.25);
    expect(parsed.analysedFrames).toBe(430);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.angleStats).toHaveProperty('spine');
  });

  it('returns honest zeros when no snapshot was ever stored', () => {
    // A session that ended before the first snapshot really did record
    // nothing. Guessing a value would invent a result.
    const parsed = parseHoldSummary(null);
    expect(parsed.heldSec).toBe(0);
    expect(parsed.meanScore).toBe(0);
    expect(parsed.errors).toEqual([]);
    expect(parsed.angleStats).toEqual({});
  });

  it('survives a malformed or older snapshot shape', () => {
    const parsed = parseHoldSummary({
      heldSec: 'not a number',
      errors: [{ nonsense: true }, { code: 'HIP_ALIGNMENT' }],
      angleStats: [1, 2, 3],
    } as never);

    expect(parsed.heldSec).toBe(0);
    expect(parsed.angleStats).toEqual({});
    // The one entry that had a usable code survives; the junk is dropped.
    expect(parsed.errors).toEqual([
      { code: 'HIP_ALIGNMENT', severity: Severity.WARNING, occurrences: 1 },
    ]);
  });
});

describe('buildHoldSummary', () => {
  it('reports seconds held and never mentions repetitions', () => {
    const summary = buildHoldSummary({
      exerciseName: 'Postural Correction',
      heldSec: 61,
      targetHoldSec: 60,
      bestStreakSec: 25,
      performanceScore: 88.5,
      completionRatio: 101.7,
      topError: 'SPINE_ALIGNMENT',
    });

    expect(summary).toContain('1m 01s');
    expect(summary).toContain('Postural Correction');
    expect(summary).toContain('spine alignment');
    expect(summary).not.toMatch(/repetition/i);
  });

  it('distinguishes total time from the longest unbroken hold', () => {
    // Six 10-second attempts is a different session from one 60-second hold,
    // and a report that hid the difference would describe the wrong one.
    const summary = buildHoldSummary({
      exerciseName: 'Postural Correction',
      heldSec: 60,
      targetHoldSec: 60,
      bestStreakSec: 10,
      performanceScore: 80,
      completionRatio: 100,
    });

    expect(summary).toContain('1m of the 1m prescribed');
    expect(summary).toContain('longest unbroken hold was 10s');
  });

  it('explains a session that recorded nothing', () => {
    const summary = buildHoldSummary({
      exerciseName: 'Postural Correction',
      heldSec: 0,
      targetHoldSec: 60,
      bestStreakSec: 0,
      performanceScore: 0,
      completionRatio: 0,
    });

    expect(summary).toMatch(/No correctly-aligned time/i);
    expect(summary).not.toMatch(/repetition/i);
  });

  it('says so plainly when no faults were detected', () => {
    const summary = buildHoldSummary({
      exerciseName: 'Postural Correction',
      heldSec: 60,
      targetHoldSec: 60,
      bestStreakSec: 60,
      performanceScore: 100,
      completionRatio: 100,
    });
    expect(summary).toContain('No recurring alignment problems');
  });
});
