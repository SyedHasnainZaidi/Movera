import { Injectable, Logger } from '@nestjs/common';
import {
  AssignmentStatus,
  ExerciseGoalType,
  NotificationType,
  Prisma,
  SessionStatus,
} from '@prisma/client';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { ReportsService } from '../reports/reports.service';

/** Statuses that mean "this session is still running". */
export const LIVE_STATUSES: SessionStatus[] = [
  SessionStatus.CREATED,
  SessionStatus.ACTIVE,
  SessionStatus.FINALIZING,
];

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * Start a session for one of the patient's own assignments.
   *
   * Everything the pose service will later be told about this session -
   * exercise, sets, reps, rule version - is captured HERE from the database.
   * The browser supplies only an assignment id.
   */
  async create(user: AuthUser, assignmentId: string) {
    const patientProfileId = this.access.requirePatientProfileId(user);

    const assignment = await this.prisma.exerciseAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        exercise: {
          include: {
            ruleConfigs: { where: { isActive: true }, take: 1 },
          },
        },
        plan: { select: { id: true, status: true, endDate: true } },
      },
    });

    if (!assignment) {
      throw AppError.notFound(
        AppErrorCode.ASSIGNMENT_NOT_FOUND,
        'That exercise assignment does not exist.',
      );
    }

    // Ownership: the assignment must belong to the caller. Checked against the
    // token's profile id, never against anything in the request body.
    if (assignment.patientId !== patientProfileId) {
      throw AppError.forbidden(
        AppErrorCode.RESOURCE_NOT_OWNED,
        'This exercise is not assigned to you.',
      );
    }

    if (assignment.status !== AssignmentStatus.ACTIVE) {
      throw AppError.badRequest(
        AppErrorCode.ASSIGNMENT_NOT_ACTIVE,
        `This exercise is ${assignment.status.toLowerCase()} and cannot be started.`,
      );
    }

    if (!assignment.exercise.isActive) {
      throw AppError.badRequest(
        AppErrorCode.EXERCISE_INACTIVE,
        'This exercise is no longer available.',
      );
    }

    const ruleConfig = assignment.exercise.ruleConfigs[0];
    if (!ruleConfig) {
      throw AppError.badRequest(
        AppErrorCode.RULE_CONFIG_MISSING,
        'This exercise has no active analysis configuration.',
      );
    }

    // One live session per patient. Rejected with a helpful error rather than
    // silently cancelling work the patient may still be doing.
    const existing = await this.prisma.exerciseSession.findFirst({
      where: { patientId: patientProfileId, status: { in: LIVE_STATUSES } },
      select: { id: true, status: true, startedAt: true },
    });

    if (existing) {
      const staleAfterMs = this.config.createdSessionTtlMinutes * 60_000;
      const isStale =
        existing.status === SessionStatus.CREATED &&
        Date.now() - existing.startedAt.getTime() > staleAfterMs;

      if (isStale) {
        // A session created but never activated (camera denied, tab closed).
        await this.prisma.exerciseSession.update({
          where: { id: existing.id },
          data: { status: SessionStatus.CANCELLED, endedAt: new Date() },
        });
      } else {
        throw AppError.conflict(
          AppErrorCode.SESSION_ALREADY_LIVE,
          'You already have a session in progress. Finish or cancel it first.',
        );
      }
    }

    const targetTotalReps = assignment.targetSets * assignment.repsPerSet;

    // The goal is COPIED onto the session, not referenced. A therapist editing
    // the exercise library or the assignment while a patient is mid-session
    // must not move the target they are working toward, and a finished
    // session's report must keep describing the goal it was actually judged
    // against.
    const goalType = assignment.exercise.goalType;
    const targetHoldSec =
      goalType === ExerciseGoalType.HOLD
        ? (assignment.holdSeconds ??
          assignment.exercise.defaultHoldSeconds ??
          null)
        : null;

    const session = await this.prisma.exerciseSession.create({
      data: {
        patientId: patientProfileId,
        assignmentId: assignment.id,
        exerciseId: assignment.exerciseId,
        ruleConfigVersion: ruleConfig.version,
        status: SessionStatus.CREATED,
        goalType,
        targetSets: assignment.targetSets,
        repsPerSet: assignment.repsPerSet,
        targetTotalReps,
        targetHoldSec,
        heldSec: goalType === ExerciseGoalType.HOLD ? 0 : null,
      },
      include: { exercise: true },
    });

    this.logger.log(
      `Session ${session.id} created for patient ${patientProfileId} (${assignment.exercise.slug})`,
    );

    return {
      id: session.id,
      status: session.status,
      exercise: {
        slug: session.exercise.slug,
        name: session.exercise.name,
        instructions: session.exercise.instructions,
        recommendedView: session.exercise.recommendedView,
        framingInstructions: session.exercise.framingInstructions,
      },
      goalType: session.goalType,
      targetSets: session.targetSets,
      repsPerSet: session.repsPerSet,
      targetTotalReps: session.targetTotalReps,
      targetHoldSec: session.targetHoldSec,
      ruleConfigVersion: session.ruleConfigVersion,
      startedAt: session.startedAt.toISOString(),
    };
  }

  /**
   * Mint the short-lived ticket the browser presents to the pose service.
   *
   * Issued only after the patient has their camera, so the ~2 minute lifetime
   * is spent on connecting rather than on waiting for a permission prompt.
   */
  async issuePoseTicket(user: AuthUser, sessionId: string) {
    const patientProfileId = this.access.requirePatientProfileId(user);
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: { id: true, patientId: true, status: true },
    });

    if (!session || session.patientId !== patientProfileId) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    if (
      session.status !== SessionStatus.CREATED &&
      session.status !== SessionStatus.ACTIVE
    ) {
      throw AppError.badRequest(
        AppErrorCode.SESSION_INVALID_STATE,
        `This session is ${session.status.toLowerCase()} and cannot be analysed.`,
      );
    }

    const { ticket, expiresIn } = await this.tokens.signPoseTicket({
      userId: user.userId,
      sessionId: session.id,
      patientProfileId,
    });

    return { ticket, expiresIn };
  }

  async findOne(user: AuthUser, sessionId: string) {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      include: {
        exercise: { select: { slug: true, name: true, category: true } },
        report: { select: { id: true } },
      },
    });

    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    await this.access.assertCanAccessPatient(user, session.patientId);

    return {
      id: session.id,
      status: session.status,
      exercise: session.exercise,
      goalType: session.goalType,
      targetSets: session.targetSets,
      repsPerSet: session.repsPerSet,
      targetTotalReps: session.targetTotalReps,
      targetHoldSec: session.targetHoldSec,
      heldSec: session.heldSec,
      totalReps: session.totalReps,
      correctReps: session.correctReps,
      incorrectReps: session.incorrectReps,
      performanceScore: session.performanceScore,
      avgTrackingConfidence: session.avgTrackingConfidence,
      startedAt: session.startedAt.toISOString(),
      activatedAt: session.activatedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      durationSec: session.durationSec,
      hasReport: session.report !== null,
    };
  }

  async listReps(user: AuthUser, sessionId: string) {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: { id: true, patientId: true },
    });
    if (!session) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }
    await this.access.assertCanAccessPatient(user, session.patientId);

    const reps = await this.prisma.repResult.findMany({
      where: { sessionId },
      orderBy: { repNumber: 'asc' },
      include: {
        errors: { select: { code: true, severity: true, occurrences: true } },
      },
    });

    return reps.map((rep) => ({
      repNumber: rep.repNumber,
      setNumber: rep.setNumber,
      correct: rep.correct,
      score: rep.score,
      trackingConfidence: rep.trackingConfidence,
      startedAt: rep.startedAt.toISOString(),
      completedAt: rep.completedAt.toISOString(),
      angleSummary: rep.angleSummary,
      errors: rep.errors,
    }));
  }

  /**
   * Finalize a session. IDEMPOTENT.
   *
   * The race this has to survive: the pose service is persisting repetition 12
   * at the same moment the patient presses Finish. Both touch the same session.
   * Resolved by moving the session to FINALIZING inside a transaction with a
   * conditional update - the rep-ingest endpoint refuses anything that is not
   * ACTIVE, so exactly one of the two wins and the loser gets a clean error
   * rather than a partially-counted report.
   */
  async complete(user: AuthUser, sessionId: string) {
    const patientProfileId = this.access.requirePatientProfileId(user);

    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: { id: true, patientId: true, status: true },
    });

    if (!session || session.patientId !== patientProfileId) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    // Already finished: return the existing report rather than erroring, so a
    // double-click or a retried request is harmless.
    if (session.status === SessionStatus.COMPLETED) {
      return this.reports.getBySessionId(user, sessionId);
    }

    if (
      session.status !== SessionStatus.ACTIVE &&
      session.status !== SessionStatus.CREATED &&
      session.status !== SessionStatus.FINALIZING
    ) {
      throw AppError.badRequest(
        AppErrorCode.SESSION_INVALID_STATE,
        `A ${session.status.toLowerCase()} session cannot be completed.`,
      );
    }

    // Claim the session. `updateMany` with a status filter is an atomic
    // compare-and-set: a concurrent caller updates 0 rows and loses cleanly.
    const claimed = await this.prisma.exerciseSession.updateMany({
      where: {
        id: sessionId,
        status: {
          in: [
            SessionStatus.ACTIVE,
            SessionStatus.CREATED,
            SessionStatus.FINALIZING,
          ],
        },
      },
      data: { status: SessionStatus.FINALIZING },
    });

    if (claimed.count === 0) {
      const current = await this.prisma.exerciseSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (current?.status === SessionStatus.COMPLETED) {
        return this.reports.getBySessionId(user, sessionId);
      }
      throw AppError.conflict(
        AppErrorCode.SESSION_ALREADY_FINALIZED,
        'This session is already being finalized.',
      );
    }

    await this.reports.finalizeSession(sessionId);
    this.logger.log(`Session ${sessionId} completed`);

    return this.reports.getBySessionId(user, sessionId);
  }

  async cancel(user: AuthUser, sessionId: string) {
    const patientProfileId = this.access.requirePatientProfileId(user);

    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      select: { id: true, patientId: true, status: true, startedAt: true },
    });

    if (!session || session.patientId !== patientProfileId) {
      throw AppError.notFound(
        AppErrorCode.SESSION_NOT_FOUND,
        'Session not found.',
      );
    }

    if (session.status === SessionStatus.CANCELLED) {
      return { id: session.id, status: session.status };
    }

    if (
      session.status !== SessionStatus.CREATED &&
      session.status !== SessionStatus.ACTIVE
    ) {
      throw AppError.badRequest(
        AppErrorCode.SESSION_INVALID_STATE,
        `A ${session.status.toLowerCase()} session cannot be cancelled.`,
      );
    }

    const endedAt = new Date();
    const updated = await this.prisma.exerciseSession.update({
      where: { id: sessionId },
      data: {
        // A patient choosing to stop is CANCELLED, never FAILED. FAILED is
        // reserved for system faults so the two are distinguishable in reports.
        status: SessionStatus.CANCELLED,
        endedAt,
        durationSec: Math.max(
          0,
          Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000),
        ),
      },
      select: { id: true, status: true },
    });

    this.logger.log(`Session ${sessionId} cancelled by patient`);
    return updated;
  }

  /** Sessions for a patient, newest first. Used by both dashboards. */
  async listForPatient(
    user: AuthUser,
    patientProfileId: string,
    page: number,
    limit: number,
  ) {
    await this.access.assertCanAccessPatient(user, patientProfileId);

    const where: Prisma.ExerciseSessionWhereInput = {
      patientId: patientProfileId,
      status: { in: [SessionStatus.COMPLETED, SessionStatus.CANCELLED] },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exerciseSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          exercise: { select: { slug: true, name: true, category: true } },
          report: { select: { id: true } },
        },
      }),
      this.prisma.exerciseSession.count({ where }),
    ]);

    return {
      rows: rows.map((s) => ({
        id: s.id,
        status: s.status,
        exercise: s.exercise,
        goalType: s.goalType,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        durationSec: s.durationSec,
        totalReps: s.totalReps,
        correctReps: s.correctReps,
        incorrectReps: s.incorrectReps,
        targetTotalReps: s.targetTotalReps,
        // Null on a REPS session. A history list showing "0 of 1 reps" for a
        // posture session would describe it as a failure rather than as an
        // exercise measured in seconds.
        targetHoldSec: s.targetHoldSec,
        heldSec: s.heldSec,
        performanceScore: s.performanceScore,
        hasReport: s.report !== null,
      })),
      total,
    };
  }

  /**
   * Scheduled sweep for sessions nobody finished.
   *
   * Without this, every denied camera permission leaves a CREATED row that
   * blocks the patient's next session under the one-live-session rule.
   */
  async sweepStaleSessions(): Promise<{ cancelled: number; failed: number }> {
    const createdCutoff = new Date(
      Date.now() - this.config.createdSessionTtlMinutes * 60_000,
    );
    const activeCutoff = new Date(
      Date.now() - this.config.activeSessionTtlMinutes * 60_000,
    );

    const cancelled = await this.prisma.exerciseSession.updateMany({
      where: { status: SessionStatus.CREATED, startedAt: { lt: createdCutoff } },
      data: { status: SessionStatus.CANCELLED, endedAt: new Date() },
    });

    // An ACTIVE session past the hard cap is a system fault (a socket that
    // never closed), not a patient decision - so FAILED, not CANCELLED.
    const failed = await this.prisma.exerciseSession.updateMany({
      where: {
        status: { in: [SessionStatus.ACTIVE, SessionStatus.FINALIZING] },
        startedAt: { lt: activeCutoff },
      },
      data: { status: SessionStatus.FAILED, endedAt: new Date() },
    });

    if (cancelled.count || failed.count) {
      this.logger.log(
        `Swept stale sessions: ${cancelled.count} cancelled, ${failed.count} failed`,
      );
    }

    return { cancelled: cancelled.count, failed: failed.count };
  }

  /** Notify the therapist that a patient finished a session. */
  async notifyTherapistOfCompletion(sessionId: string): Promise<void> {
    const session = await this.prisma.exerciseSession.findUnique({
      where: { id: sessionId },
      include: {
        exercise: { select: { name: true } },
        patient: {
          include: {
            user: { select: { firstName: true, lastName: true } },
            therapists: {
              where: { status: 'ACTIVE' },
              include: { therapist: { select: { userId: true } } },
            },
          },
        },
      },
    });
    if (!session) return;

    const patientName = `${session.patient.user.firstName} ${session.patient.user.lastName}`;
    await this.prisma.notification.createMany({
      data: session.patient.therapists.map((link) => ({
        userId: link.therapist.userId,
        type: NotificationType.SESSION_COMPLETED,
        title: 'Session completed',
        message: `${patientName} completed ${session.exercise.name}.`,
        payload: { sessionId: session.id, patientId: session.patientId },
      })),
    });
  }
}
