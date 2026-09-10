import { Injectable, Logger } from '@nestjs/common';
import {
  ExerciseGoalType,
  Prisma,
  SessionStatus,
  Severity,
} from '@prisma/client';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { IngestHoldDto, IngestRepDto } from './dto/internal.dto';

/**
 * Known error codes, mirroring app/feedback/codes.py in the pose service.
 *
 * Duplicated deliberately rather than shared through a package: the two
 * services are written in different languages, and a code arriving from the
 * pose service is UNTRUSTED input that must be validated against a list this
 * service owns. An unknown code is rejected, which catches drift immediately
 * instead of silently writing junk into session_errors.
 */
export const KNOWN_ERROR_CODES = new Set([
  'NO_PERSON_DETECTED',
  'PARTIAL_BODY_VISIBLE',
  'LOW_CONFIDENCE',
  'MULTIPLE_PEOPLE',
  'FRAME_DECODE_ERROR',
  'INSUFFICIENT_DEPTH',
  'EXCESSIVE_DEPTH',
  'TRUNK_LEAN',
  'ASYMMETRIC_LOAD',
  'KNEE_ALIGNMENT',
  'ELBOW_DRIFT',
  'INCOMPLETE_ROM',
  'SHOULDER_HITCH',
  'TRUNK_COMPENSATION',
  'MOVEMENT_TOO_FAST',
  // straight leg raise
  'KNEE_FLEXED',
  // static posture
  'SHOULDER_ALIGNMENT',
  'HIP_ALIGNMENT',
  'SPINE_ALIGNMENT',
]);

const SEVERITY_BY_CODE: Record<string, Severity> = {
  NO_PERSON_DETECTED: Severity.CRITICAL,
  PARTIAL_BODY_VISIBLE: Severity.CRITICAL,
  LOW_CONFIDENCE: Severity.WARNING,
  MULTIPLE_PEOPLE: Severity.WARNING,
  FRAME_DECODE_ERROR: Severity.WARNING,
  INSUFFICIENT_DEPTH: Severity.WARNING,
  EXCESSIVE_DEPTH: Severity.WARNING,
  TRUNK_LEAN: Severity.WARNING,
  ASYMMETRIC_LOAD: Severity.INFO,
  KNEE_ALIGNMENT: Severity.WARNING,
  ELBOW_DRIFT: Severity.WARNING,
  INCOMPLETE_ROM: Severity.WARNING,
  SHOULDER_HITCH: Severity.WARNING,
  TRUNK_COMPENSATION: Severity.WARNING,
  MOVEMENT_TOO_FAST: Severity.INFO,
  KNEE_FLEXED: Severity.WARNING,
  SHOULDER_ALIGNMENT: Severity.WARNING,
  HIP_ALIGNMENT: Severity.WARNING,
  SPINE_ALIGNMENT: Severity.WARNING,
};

@Injectable()
export class InternalService {
  private readonly logger = new Logger(InternalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything the pose service needs to analyse this session, from the
   * database rather than from the browser.
   *
   * This is the mechanism that makes the client non-authoritative: a browser
   * claiming `targetReps: 1000` or a relaxed threshold changes nothing,
   * because the analyzer is configured from here, keyed on the session id
   * inside the signed pose ticket.
   */
  async getAnalyzerContext(sessionId: string) {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      include: {
        exercise: {
          include: { ruleConfigs: { where: { isActive: true }, take: 1 } },
        },
      },
    });

    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    if (
      session.status !== SessionStatus.CREATED &&
      session.status !== SessionStatus.ACTIVE
    ) {
      throw AppError.conflict(
        AppErrorCode.SESSION_INVALID_STATE,
        `Session is ${session.status.toLowerCase()} and cannot be analysed.`,
      );
    }

    const ruleConfig = session.exercise.ruleConfigs[0];
    if (!ruleConfig) {
      throw AppError.badRequest(
        AppErrorCode.RULE_CONFIG_MISSING,
        'This exercise has no active analysis configuration.',
      );
    }

    // Repetitions already persisted. A reconnecting analyzer seeds its counter
    // from this, so a pose-service restart mid-session resumes at rep 6 rather
    // than replaying from 1.
    const currentPersistedRepCount = await this.prisma.repResult.count({
      where: { sessionId },
    });

    return {
      sessionId: session.id,
      sessionStatus: session.status,
      exerciseSlug: session.exercise.slug,
      exerciseName: session.exercise.name,
      ruleConfigVersion: ruleConfig.version,
      recommendedView: session.exercise.recommendedView,
      framingInstructions: session.exercise.framingInstructions,
      targetSets: session.targetSets,
      repsPerSet: session.repsPerSet,
      targetTotalReps: session.targetTotalReps,
      currentPersistedRepCount,
      // Goal type and duration are read from the SESSION, not the exercise:
      // they were copied at creation, so a therapist editing the library
      // mid-session cannot change the target the patient is working toward.
      goalType: session.goalType,
      targetHoldSec: session.targetHoldSec,
      // Seconds already credited. Lets a reconnecting analyzer resume at 40 s
      // instead of restarting the patient at zero - the same guarantee
      // currentPersistedRepCount gives repetitions.
      currentHeldSec: session.heldSec ?? 0,
      ruleConfig: {
        requiredLandmarks: ruleConfig.requiredLandmarks,
        angleDefinitions: ruleConfig.angleDefinitions,
        movementStateConfig: ruleConfig.movementStateConfig,
        postureRules: ruleConfig.postureRules,
        minVisibility: ruleConfig.minVisibility,
        repCorrectnessThreshold: ruleConfig.repCorrectnessThreshold,
        validationStatus: ruleConfig.validationStatus,
      },
    };
  }

  /**
   * CREATED -> ACTIVE, driven by the pose service once an analyzer is attached
   * and a valid pose has been seen.
   *
   * Activating here rather than at creation means ACTIVE genuinely implies
   * "analysis is running", so a patient who denies camera permission leaves a
   * CREATED row for the sweeper rather than a misleading ACTIVE one.
   */
  async activateSession(sessionId: string) {
    const now = new Date();

    // Conditional update: only CREATED transitions. A second call is a no-op
    // rather than an error, because the pose service may retry after a
    // transient network failure.
    const claimed = await this.prisma.exerciseSession.updateMany({
      where: { id: sessionId, status: SessionStatus.CREATED },
      data: { status: SessionStatus.ACTIVE, activatedAt: now },
    });

    if (claimed.count > 0) {
      this.logger.log(`Session ${sessionId} activated`);
      return { sessionId, status: SessionStatus.ACTIVE, activatedAt: now };
    }

    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: { status: true, activatedAt: true },
    });

    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    if (session.status === SessionStatus.ACTIVE) {
      return {
        sessionId,
        status: session.status,
        activatedAt: session.activatedAt,
      };
    }

    throw AppError.conflict(
      AppErrorCode.SESSION_INVALID_STATE,
      `Session is ${session.status.toLowerCase()} and cannot be activated.`,
    );
  }

  /**
   * Persist one completed repetition.
   *
   * Idempotent by construction. `ingestKey` is deterministic
   * ("<sessionId>:<repNumber>") and UNIQUE in the database, so a retry after a
   * network timeout returns the existing row instead of creating a duplicate.
   * The guarantee is a database constraint, not an application check, so it
   * holds under concurrency too.
   */
  async ingestRep(sessionId: string, dto: IngestRepDto) {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        goalType: true,
        targetTotalReps: true,
        targetSets: true,
      },
    });

    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    // A held session counts no repetitions, so it must not be able to store
    // one. The analyzer will not produce any, but this endpoint is the
    // boundary and the boundary is what enforces it: a stored RepResult here
    // would be ignored by the report and still inflate the patient's lifetime
    // repetition totals, which is the kind of wrong number nobody goes looking
    // for. Symmetric with ingestHold refusing a REPS session.
    if (session.goalType === ExerciseGoalType.HOLD) {
      throw AppError.badRequest(
        AppErrorCode.VALIDATION_FAILED,
        'This session is scored in held time, not repetitions.',
      );
    }

    // Repetitions are accepted ONLY while the session is live. This is the
    // other half of the finalization race: once complete() has moved the
    // session to FINALIZING, a late rep is rejected rather than landing after
    // the totals were computed.
    if (session.status !== SessionStatus.ACTIVE) {
      throw AppError.conflict(
        AppErrorCode.SESSION_NOT_ACTIVE,
        `Session is ${session.status.toLowerCase()}; repetitions are no longer accepted.`,
      );
    }

    if (dto.repNumber < 1 || dto.repNumber > session.targetTotalReps) {
      throw AppError.badRequest(
        AppErrorCode.REP_OUT_OF_RANGE,
        `Repetition ${dto.repNumber} is outside the prescribed range of 1-${session.targetTotalReps}.`,
      );
    }

    const unknown = dto.errors?.filter((e) => !KNOWN_ERROR_CODES.has(e.code));
    if (unknown && unknown.length > 0) {
      throw AppError.badRequest(
        AppErrorCode.REP_UNKNOWN_ERROR_CODE,
        `Unknown error code(s): ${unknown.map((e) => e.code).join(', ')}`,
      );
    }

    const expectedKey = `${sessionId}:${dto.repNumber}`;
    if (dto.ingestKey !== expectedKey) {
      throw AppError.badRequest(
        AppErrorCode.VALIDATION_FAILED,
        'ingestKey does not match the session and repetition number.',
      );
    }

    const existing = await this.prisma.repResult.findUnique({
      where: { ingestKey: dto.ingestKey },
      select: { id: true, repNumber: true, correct: true, score: true },
    });
    if (existing) {
      // Idempotent replay - return the stored result unchanged.
      return { ...existing, duplicate: true };
    }

    const setNumber = Math.min(
      session.targetSets,
      Math.max(1, dto.setNumber),
    );

    try {
      const rep = await this.prisma.$transaction(async (tx) => {
        const created = await tx.repResult.create({
          data: {
            sessionId,
            repNumber: dto.repNumber,
            setNumber,
            startedAt: new Date(dto.startedAt),
            completedAt: new Date(dto.completedAt),
            correct: dto.correct,
            score: clamp(dto.score, 0, 100),
            trackingConfidence: clamp(dto.trackingConfidence, 0, 1),
            angleSummary: (dto.angleSummary ??
              {}) as unknown as Prisma.InputJsonValue,
            ingestKey: dto.ingestKey,
          },
          select: { id: true, repNumber: true, correct: true, score: true },
        });

        if (dto.errors && dto.errors.length > 0) {
          await tx.sessionError.createMany({
            data: dto.errors.map((error) => ({
              sessionId,
              repResultId: created.id,
              code: error.code,
              severity: SEVERITY_BY_CODE[error.code] ?? Severity.WARNING,
              occurrences: Math.max(1, error.occurrences),
            })),
          });
        }

        return created;
      });

      return { ...rep, duplicate: false };
    } catch (error) {
      // Lost a race with a concurrent retry: the unique constraint fired, so
      // the repetition is already stored. Return it rather than failing.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const stored = await this.prisma.repResult.findUnique({
          where: { ingestKey: dto.ingestKey },
          select: { id: true, repNumber: true, correct: true, score: true },
        });
        if (stored) return { ...stored, duplicate: true };
      }
      throw error;
    }
  }

  /**
   * Record cumulative hold progress for a HOLD session.
   *
   * Idempotent for a different reason than ingestRep. A repetition is a
   * discrete event that must be stored exactly once, so it needs a unique key.
   * A hold snapshot is a RESTATEMENT of the whole session, so storing the same
   * one twice changes nothing and losing one costs only staleness.
   *
   * What does need guarding is direction: held seconds may only ever increase.
   * A snapshot that arrives out of order - the retry of an earlier post
   * landing after a later one - would otherwise rewind the patient's progress.
   */
  async ingestHold(sessionId: string, dto: IngestHoldDto) {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        goalType: true,
        targetHoldSec: true,
        heldSec: true,
      },
    });

    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    if (session.goalType !== ExerciseGoalType.HOLD) {
      throw AppError.badRequest(
        AppErrorCode.VALIDATION_FAILED,
        'This session is scored in repetitions, not held time.',
      );
    }

    // Same finalization race as repetitions: once complete() has claimed the
    // session, a late snapshot must not land after the totals were computed.
    if (session.status !== SessionStatus.ACTIVE) {
      throw AppError.conflict(
        AppErrorCode.SESSION_NOT_ACTIVE,
        `Session is ${session.status.toLowerCase()}; progress is no longer accepted.`,
      );
    }

    const unknown = dto.errors?.filter((e) => !KNOWN_ERROR_CODES.has(e.code));
    if (unknown && unknown.length > 0) {
      throw AppError.badRequest(
        AppErrorCode.REP_UNKNOWN_ERROR_CODE,
        `Unknown error code(s): ${unknown.map((e) => e.code).join(', ')}`,
      );
    }

    // Never rewind, and never credit more than was prescribed.
    const ceiling = session.targetHoldSec ?? dto.heldSec;
    const heldSec = round2(
      Math.min(Math.max(dto.heldSec, session.heldSec ?? 0), ceiling),
    );

    await this.prisma.exerciseSession.update({
      where: { id: sessionId },
      data: {
        heldSec,
        holdSummary: {
          heldSec,
          bestStreakSec: round2(dto.bestStreakSec ?? 0),
          analysedFrames: dto.analysedFrames,
          meanScore: clamp(dto.meanScore, 0, 100),
          meanConfidence: clamp(dto.meanConfidence, 0, 1),
          angleStats: dto.angleSummary ?? {},
          errors: (dto.errors ?? []).map((e) => ({
            code: e.code,
            severity: SEVERITY_BY_CODE[e.code] ?? Severity.WARNING,
            occurrences: Math.max(1, e.occurrences),
          })),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { sessionId, heldSec, targetHoldSec: session.targetHoldSec };
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
