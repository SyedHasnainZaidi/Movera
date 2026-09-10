import { Injectable, Logger } from '@nestjs/common';
import {
  ExerciseGoalType,
  Prisma,
  SessionStatus,
  Severity,
} from '@prisma/client';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

interface AngleStat {
  min: number;
  max: number;
  mean: number;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
  ) {}

  /**
   * Compute the authoritative session summary and write the report.
   *
   * EVERY number here is derived from rows this backend persisted and
   * validated - RepResult rows for a repetition exercise, the stored hold
   * snapshot for a held-position one. Nothing is taken from the browser. That
   * is what makes the report trustworthy, and it is the direct fix for the
   * superseded prototype, whose React page posted a literal `accuracy: 80`.
   *
   * Runs in a transaction so a crash cannot leave a session marked COMPLETED
   * with no report, or a report with stale totals.
   */
  async finalizeSession(sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.exerciseSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { exercise: { select: { name: true, slug: true } } },
      });

      const endedAt = session.endedAt ?? new Date();
      const durationSec = Math.max(
        0,
        Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000),
      );

      // A HOLD session has no repetitions to average, so it is summarised from
      // the cumulative snapshot the pose service posted instead. Split here
      // rather than threading conditionals through the rep path, because the
      // two share only their session row.
      if (session.goalType === ExerciseGoalType.HOLD) {
        await this.finalizeHoldSession(tx, session, endedAt, durationSec);
        return;
      }

      const reps = await tx.repResult.findMany({
        where: { sessionId },
        orderBy: { repNumber: 'asc' },
        include: { errors: true },
      });

      const totalReps = reps.length;
      const correctReps = reps.filter((r) => r.correct).length;
      const incorrectReps = totalReps - correctReps;

      // Session score = mean of per-rep scores. Simple, bounded, explainable
      // and testable - deliberately not an opaque "AI accuracy" figure.
      const performanceScore =
        totalReps > 0
          ? round1(reps.reduce((sum, r) => sum + r.score, 0) / totalReps)
          : 0;

      const avgTrackingConfidence =
        totalReps > 0
          ? round3(
              reps.reduce((sum, r) => sum + r.trackingConfidence, 0) / totalReps,
            )
          : 0;

      const angleStats = aggregateAngles(reps.map((r) => r.angleSummary));
      const commonErrors = aggregateErrors(reps.flatMap((r) => r.errors));

      const completionRatio =
        session.targetTotalReps > 0
          ? round1((totalReps / session.targetTotalReps) * 100)
          : 0;

      const summary = buildSummary({
        exerciseName: session.exercise.name,
        totalReps,
        targetTotalReps: session.targetTotalReps,
        correctReps,
        performanceScore,
        completionRatio,
        topError: commonErrors[0]?.code,
      });

      await tx.exerciseSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.COMPLETED,
          endedAt,
          durationSec,
          totalReps,
          correctReps,
          incorrectReps,
          performanceScore,
          avgTrackingConfidence,
        },
      });

      // upsert, not create: the unique constraint on sessionId is what makes
      // a repeated completion idempotent rather than a duplicate-key error.
      await tx.sessionReport.upsert({
        where: { sessionId },
        create: {
          sessionId,
          summary,
          angleStats: angleStats as unknown as Prisma.InputJsonValue,
          commonErrors: commonErrors as unknown as Prisma.InputJsonValue,
          trackingSummary: {
            meanConfidence: avgTrackingConfidence,
            repsAnalysed: totalReps,
            completionRatio,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          summary,
          angleStats: angleStats as unknown as Prisma.InputJsonValue,
          commonErrors: commonErrors as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
      });

      await tx.sessionMetric.deleteMany({ where: { sessionId } });
      await tx.sessionMetric.createMany({
        data: [
          { sessionId, key: 'completion_ratio', value: completionRatio },
          { sessionId, key: 'duration_sec', value: durationSec },
          {
            sessionId,
            key: 'correct_rep_ratio',
            value: totalReps > 0 ? round1((correctReps / totalReps) * 100) : 0,
          },
        ],
      });
    });

    this.logger.log(`Report generated for session ${sessionId}`);
  }

  /**
   * Finalize a HOLD session from its cumulative posture snapshot.
   *
   * The trust model is the same as the repetition path even though the shape
   * differs: every figure comes from a snapshot this backend validated on
   * ingest and stored itself, never from the browser. What changes is the
   * denominator - completion is measured in seconds held against seconds
   * prescribed, not repetitions performed against repetitions prescribed.
   *
   * Rep totals are written as an explicit 0. A posture session genuinely
   * performed no repetitions, and leaving stale non-zero values behind would
   * be worse than saying so.
   */
  private async finalizeHoldSession(
    tx: Prisma.TransactionClient,
    session: {
      id: string;
      startedAt: Date;
      targetHoldSec: number | null;
      heldSec: number | null;
      holdSummary: Prisma.JsonValue;
      exercise: { name: string };
    },
    endedAt: Date,
    durationSec: number,
  ): Promise<void> {
    const summaryJson = parseHoldSummary(session.holdSummary);
    const heldSec = round1(session.heldSec ?? summaryJson.heldSec);
    const targetHoldSec = session.targetHoldSec ?? 0;

    const completionRatio =
      targetHoldSec > 0 ? round1((heldSec / targetHoldSec) * 100) : 0;

    // Mean of the per-frame posture scores. The same "simple, bounded,
    // explainable" figure the repetition path produces, computed over frames
    // rather than over repetitions.
    const performanceScore = round1(summaryJson.meanScore);
    const avgTrackingConfidence = round3(summaryJson.meanConfidence);
    const commonErrors = aggregateErrors(summaryJson.errors);

    const summary = buildHoldSummary({
      exerciseName: session.exercise.name,
      heldSec,
      targetHoldSec,
      bestStreakSec: round1(summaryJson.bestStreakSec),
      performanceScore,
      completionRatio,
      topError: commonErrors[0]?.code,
    });

    await tx.exerciseSession.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.COMPLETED,
        endedAt,
        durationSec,
        heldSec,
        totalReps: 0,
        correctReps: 0,
        incorrectReps: 0,
        performanceScore,
        avgTrackingConfidence,
      },
    });

    await tx.sessionReport.upsert({
      where: { sessionId: session.id },
      create: {
        sessionId: session.id,
        summary,
        angleStats: summaryJson.angleStats as unknown as Prisma.InputJsonValue,
        commonErrors: commonErrors as unknown as Prisma.InputJsonValue,
        trackingSummary: {
          meanConfidence: avgTrackingConfidence,
          framesAnalysed: summaryJson.analysedFrames,
          completionRatio,
        } as unknown as Prisma.InputJsonValue,
      },
      update: {
        summary,
        angleStats: summaryJson.angleStats as unknown as Prisma.InputJsonValue,
        commonErrors: commonErrors as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });

    await tx.sessionMetric.deleteMany({ where: { sessionId: session.id } });
    await tx.sessionMetric.createMany({
      data: [
        { sessionId: session.id, key: 'completion_ratio', value: completionRatio },
        { sessionId: session.id, key: 'duration_sec', value: durationSec },
        { sessionId: session.id, key: 'hold_sec', value: heldSec },
        { sessionId: session.id, key: 'target_hold_sec', value: targetHoldSec },
        {
          sessionId: session.id,
          key: 'best_streak_sec',
          value: round1(summaryJson.bestStreakSec),
        },
      ],
    });
  }

  async getBySessionId(user: AuthUser, sessionId: string) {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      include: {
        exercise: { select: { name: true, slug: true, category: true } },
        report: true,
        patient: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    await this.access.assertCanAccessPatient(user, session.patientId);

    if (!session.report) {
      throw AppError.notFound(
        AppErrorCode.REPORT_NOT_FOUND,
        'No report exists for this session yet.',
      );
    }

    return {
      sessionId: session.id,
      generatedAt: session.report.generatedAt.toISOString(),
      patient: {
        id: session.patientId,
        name: `${session.patient.user.firstName} ${session.patient.user.lastName}`,
      },
      exercise: session.exercise,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      durationSec: session.durationSec ?? 0,
      // Which of `prescription.*` and `hold` the reader should believe. A HOLD
      // session carries sets and reps only because the columns are NOT NULL;
      // they describe nothing that happened.
      goalType: session.goalType,
      prescription: {
        targetSets: session.targetSets,
        repsPerSet: session.repsPerSet,
        targetTotalReps: session.targetTotalReps,
      },
      hold:
        session.goalType === ExerciseGoalType.HOLD
          ? {
              targetSec: session.targetHoldSec ?? 0,
              heldSec: round1(session.heldSec ?? 0),
              bestStreakSec: round1(
                parseHoldSummary(session.holdSummary).bestStreakSec,
              ),
            }
          : null,
      results: {
        totalReps: session.totalReps,
        correctReps: session.correctReps,
        incorrectReps: session.incorrectReps,
        performanceScore: session.performanceScore ?? 0,
        completionRatio: computeCompletionRatio(session),
      },
      tracking: {
        avgConfidence: session.avgTrackingConfidence ?? 0,
        note: 'Tracking confidence measures how clearly the camera could see the patient. It is not a measure of exercise correctness.',
      },
      angleStats: session.report.angleStats,
      commonErrors: session.report.commonErrors,
      summary: session.report.summary,
      disclaimer:
        'Prototype analysis. Angle thresholds are unvalidated defaults requiring physiotherapist review.',
    };
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers - pure functions, unit-tested in reports.service.spec.ts
// ---------------------------------------------------------------------------

export function aggregateAngles(
  summaries: Prisma.JsonValue[],
): Record<string, AngleStat> {
  const buckets = new Map<string, { mins: number[]; maxes: number[]; means: number[] }>();

  for (const raw of summaries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    for (const [angle, stat] of Object.entries(raw as Record<string, unknown>)) {
      if (!stat || typeof stat !== 'object') continue;
      const s = stat as Record<string, unknown>;
      if (
        typeof s.min !== 'number' ||
        typeof s.max !== 'number' ||
        typeof s.mean !== 'number'
      ) {
        continue;
      }
      const bucket = buckets.get(angle) ?? { mins: [], maxes: [], means: [] };
      bucket.mins.push(s.min);
      bucket.maxes.push(s.max);
      bucket.means.push(s.mean);
      buckets.set(angle, bucket);
    }
  }

  const result: Record<string, AngleStat> = {};
  for (const [angle, bucket] of buckets) {
    result[angle] = {
      // Across the whole session: the smallest minimum and largest maximum any
      // repetition reached, and the mean of per-rep means.
      min: round1(Math.min(...bucket.mins)),
      max: round1(Math.max(...bucket.maxes)),
      mean: round1(
        bucket.means.reduce((a, b) => a + b, 0) / bucket.means.length,
      ),
    };
  }
  return result;
}

export function aggregateErrors(
  errors: { code: string; severity: Severity; occurrences: number }[],
): { code: string; severity: Severity; occurrences: number; repsAffected: number }[] {
  const map = new Map<
    string,
    { severity: Severity; occurrences: number; repsAffected: number }
  >();

  for (const error of errors) {
    const entry = map.get(error.code) ?? {
      severity: error.severity,
      occurrences: 0,
      repsAffected: 0,
    };
    entry.occurrences += error.occurrences;
    entry.repsAffected += 1;
    map.set(error.code, entry);
  }

  return [...map.entries()]
    .map(([code, entry]) => ({ code, ...entry }))
    .sort((a, b) => b.repsAffected - a.repsAffected);
}

interface SummaryInput {
  exerciseName: string;
  totalReps: number;
  targetTotalReps: number;
  correctReps: number;
  performanceScore: number;
  completionRatio: number;
  topError?: string;
}

/**
 * Plain-language summary. Supportive and factual - it reports what happened
 * and never makes a clinical judgement.
 */
export function buildSummary(input: SummaryInput): string {
  if (input.totalReps === 0) {
    return `No repetitions were recorded for this ${input.exerciseName} session. This usually means the camera could not see the full body clearly.`;
  }

  const parts: string[] = [
    `Completed ${input.totalReps} of ${input.targetTotalReps} prescribed repetitions (${input.completionRatio}%) of ${input.exerciseName}.`,
    `${input.correctReps} repetition${input.correctReps === 1 ? '' : 's'} met the configured form criteria, giving an average form score of ${input.performanceScore}/100.`,
  ];

  if (input.topError) {
    parts.push(
      `The most frequently detected issue was ${humanize(input.topError)}.`,
    );
  } else {
    parts.push('No recurring form issues were detected.');
  }

  return parts.join(' ');
}

/**
 * Completion against whatever this session's goal actually was.
 *
 * Measured in seconds for a HOLD session and repetitions for a REPS one. The
 * two share a percentage but not a denominator, and using the rep denominator
 * for a posture session would report every one of them as 0%.
 */
export function computeCompletionRatio(session: {
  goalType: ExerciseGoalType;
  totalReps: number;
  targetTotalReps: number;
  heldSec: number | null;
  targetHoldSec: number | null;
}): number {
  if (session.goalType === ExerciseGoalType.HOLD) {
    const target = session.targetHoldSec ?? 0;
    return target > 0 ? round1(((session.heldSec ?? 0) / target) * 100) : 0;
  }
  return session.targetTotalReps > 0
    ? round1((session.totalReps / session.targetTotalReps) * 100)
    : 0;
}

interface HoldSummaryInput {
  exerciseName: string;
  heldSec: number;
  targetHoldSec: number;
  bestStreakSec: number;
  performanceScore: number;
  completionRatio: number;
  topError?: string;
}

/**
 * Plain-language summary for a held-position session.
 *
 * Says nothing about repetitions, because none were performed. The distinction
 * between accumulated time and the longest unbroken stretch is stated
 * explicitly - a patient who reached 60 seconds in six 10-second attempts did
 * something different from one who held it once, and a report that hid that
 * would be describing a different session.
 */
export function buildHoldSummary(input: HoldSummaryInput): string {
  if (input.heldSec <= 0) {
    return `No correctly-aligned time was recorded for this ${input.exerciseName} session. This usually means the camera could not see you clearly, or the alignment cues on screen were not met.`;
  }

  const parts: string[] = [
    input.targetHoldSec > 0
      ? `Held correct alignment for ${formatDuration(input.heldSec)} of the ${formatDuration(input.targetHoldSec)} prescribed (${input.completionRatio}%) during ${input.exerciseName}.`
      : `Held correct alignment for ${formatDuration(input.heldSec)} during ${input.exerciseName}.`,
    `The longest unbroken hold was ${formatDuration(input.bestStreakSec)}, with an average alignment score of ${input.performanceScore}/100.`,
  ];

  if (input.topError) {
    parts.push(
      `Alignment was most often interrupted by ${humanize(input.topError)}.`,
    );
  } else {
    parts.push('No recurring alignment problems were detected.');
  }

  return parts.join(' ');
}

interface ParsedHoldSummary {
  heldSec: number;
  bestStreakSec: number;
  analysedFrames: number;
  meanScore: number;
  meanConfidence: number;
  angleStats: Record<string, unknown>;
  errors: { code: string; severity: Severity; occurrences: number }[];
}

/**
 * Read the stored hold snapshot defensively.
 *
 * It is a Json column, so it can be null (a session that ended before the
 * first snapshot was posted) or a shape written by an older build. Every field
 * falls back to a zero that is true rather than to a guess: a session with no
 * snapshot really did record nothing, and should say so.
 */
export function parseHoldSummary(raw: Prisma.JsonValue): ParsedHoldSummary {
  const empty: ParsedHoldSummary = {
    heldSec: 0,
    bestStreakSec: 0,
    analysedFrames: 0,
    meanScore: 0,
    meanConfidence: 0,
    angleStats: {},
    errors: [],
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const source = raw as Record<string, unknown>;

  const num = (key: string): number =>
    typeof source[key] === 'number' && Number.isFinite(source[key])
      ? (source[key] as number)
      : 0;

  const angleStats =
    source.angleStats && typeof source.angleStats === 'object' &&
    !Array.isArray(source.angleStats)
      ? (source.angleStats as Record<string, unknown>)
      : {};

  const errors = Array.isArray(source.errors)
    ? source.errors.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const e = entry as Record<string, unknown>;
        if (typeof e.code !== 'string') return [];
        return [
          {
            code: e.code,
            severity: (e.severity as Severity) ?? Severity.WARNING,
            occurrences:
              typeof e.occurrences === 'number' ? e.occurrences : 1,
          },
        ];
      })
    : [];

  return {
    heldSec: num('heldSec'),
    bestStreakSec: num('bestStreakSec'),
    analysedFrames: num('analysedFrames'),
    meanScore: num('meanScore'),
    meanConfidence: num('meanConfidence'),
    angleStats,
    errors,
  };
}

/** "1m 05s" / "45s". Seconds are what a patient actually reads. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0
    ? `${minutes}m`
    : `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function humanize(code: string): string {
  return code.toLowerCase().replace(/_/g, ' ');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
