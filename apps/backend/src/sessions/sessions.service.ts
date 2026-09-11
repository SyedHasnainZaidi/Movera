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

/**
 * How long a session may sit in FINALIZING before it is considered abandoned.
 *
 * complete() claims the row as FINALIZING and then writes the report inside a
 * transaction - milliseconds apart. Anything still FINALIZING after this long
 * is not in flight, it is stranded: the process died, the transaction failed,
 * or the request was cut off between the two steps.
 *
 * Thirty seconds is deliberately far longer than finalization can legitimately
 * take, so a healthy completion is never mistaken for a stuck one.
 */
const FINALIZING_STALE_MS = 30_000;

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

    // Clear any stranded finalization BEFORE looking for a blocker, so a row
    // that is only nominally live cannot refuse the patient a session. Done
    // here rather than left to the sweep because the sweep runs every five
    // minutes and the patient is standing in front of their camera now.
    await this.recoverStuckFinalizing(patientProfileId);

    // One live session per patient - but "already live" is not automatically a
    // conflict. Three cases, and telling them apart is what stops a patient
    // getting permanently locked out of their own exercise.
    const existing = await this.prisma.exerciseSession.findFirst({
      where: { patientId: patientProfileId, status: { in: LIVE_STATUSES } },
      select: {
        id: true,
        status: true,
        startedAt: true,
        assignmentId: true,
        exercise: { select: { name: true } },
      },
    });

    if (existing) {
      // 1. SAME exercise -> resume it.
      //
      // A dropped socket, a backgrounded tab the browser discarded, a reload:
      // the patient comes back to the exercise they were already doing and
      // must get their session back, not a refusal. Creating a second session
      // would orphan the repetitions already recorded against the first, and
      // refusing outright left them stuck until the 2-hour sweep - with no
      // control anywhere in the UI to clear it, which is the bug this fixes.
      //
      // Resuming is safe because the analyzer is rebuilt from the PERSISTED
      // repetition count when the pose service reconnects, so the count picks
      // up where it left off instead of restarting at zero.
      //
      // FINALIZING is excluded deliberately: that session is mid-completion,
      // and handing it back as resumable would race the finalizer.
      if (
        existing.assignmentId === assignmentId &&
        existing.status !== SessionStatus.FINALIZING
      ) {
        const resumed = await this.prisma.exerciseSession.findUniqueOrThrow({
          where: { id: existing.id },
          include: { exercise: true },
        });
        this.logger.log(
          `Session ${resumed.id} resumed by patient ${patientProfileId} (${assignment.exercise.slug})`,
        );
        return this.toCreatedDto(resumed, true);
      }

      const staleAfterMs = this.config.createdSessionTtlMinutes * 60_000;
      const isStale =
        existing.status === SessionStatus.CREATED &&
        Date.now() - existing.startedAt.getTime() > staleAfterMs;

      if (isStale) {
        // 2. A session created but never activated (camera denied, tab closed)
        //    on a DIFFERENT exercise. Nothing was recorded; clear it.
        await this.prisma.exerciseSession.update({
          where: { id: existing.id },
          data: { status: SessionStatus.CANCELLED, endedAt: new Date() },
        });
      } else {
        // 3. A genuinely different exercise is in progress. Still refused -
        //    but the client is told WHICH session, so it can offer to resume
        //    or cancel it instead of leaving the patient at a dead end.
        throw AppError.conflict(
          AppErrorCode.SESSION_ALREADY_LIVE,
          `You have a session in progress on ${existing.exercise.name}. Finish or cancel it before starting another.`,
          {
            sessionId: existing.id,
            assignmentId: existing.assignmentId,
            exerciseName: existing.exercise.name,
            status: existing.status,
            startedAt: existing.startedAt.toISOString(),
          },
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

    return this.toCreatedDto(session, false);
  }

  /**
   * Finish, or fail, any session stranded in FINALIZING.
   *
   * FINALIZING is the one status a patient could be trapped behind. It counts
   * as live, so it blocks the next session; it is excluded from resuming,
   * because resuming a session that is mid-completion would race the
   * finalizer; and cancel() refuses it. A row that reached it and stopped was
   * therefore unreachable from every direction until the two-hour sweep - the
   * exact dead end the resume fix was meant to remove, wearing a different
   * label.
   *
   * Finalizing is attempted rather than simply cancelling, because a session
   * gets to FINALIZING only by the patient asking to complete it: the
   * repetitions are already recorded, and the report can still be built from
   * them. Only if that genuinely fails is the session marked FAILED - a system
   * fault, never CANCELLED, which would misreport it as the patient's choice.
   *
   * Scoped to one patient: this runs on the hot path of starting a session and
   * has no business touching anybody else's rows.
   */
  private async recoverStuckFinalizing(patientProfileId: string): Promise<void> {
    const cutoff = new Date(Date.now() - FINALIZING_STALE_MS);

    const stranded = await this.prisma.exerciseSession.findMany({
      where: {
        patientId: patientProfileId,
        status: SessionStatus.FINALIZING,
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });

    for (const session of stranded) {
      await this.finalizeStranded(session.id);
    }
  }

  /**
   * Complete one stranded session, falling back to FAILED.
   *
   * finalizeSession is idempotent - the report is upserted on a unique
   * sessionId - so running it against a row a previous attempt got halfway
   * through is safe.
   */
  private async finalizeStranded(sessionId: string): Promise<void> {
    try {
      await this.reports.finalizeSession(sessionId);
      this.logger.warn(
        `Session ${sessionId} was stranded in FINALIZING and has been completed`,
      );
    } catch (error) {
      await this.prisma.exerciseSession.updateMany({
        where: { id: sessionId, status: SessionStatus.FINALIZING },
        data: { status: SessionStatus.FAILED, endedAt: new Date() },
      });
      this.logger.error(
        `Session ${sessionId} could not be finalized and was marked FAILED`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * The shape POST /sessions returns, for a new session and a resumed one
   * alike.
   *
   * Identical on purpose: the browser sets up the camera, mints a ticket and
   * connects the socket from this payload, and none of that should depend on
   * whether the session is seconds or minutes old. `resumed` is the single
   * difference, and it only changes what the screen SAYS - so that a patient
   * returning to a session already holding repetitions is told so rather than
   * being left to wonder why the counter does not start at zero.
   */
  private toCreatedDto(
    session: Prisma.ExerciseSessionGetPayload<{ include: { exercise: true } }>,
    resumed: boolean,
  ) {
    return {
      id: session.id,
      status: session.status,
      resumed,
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
      select: {
        id: true,
        patientId: true,
        status: true,
        startedAt: true,
        updatedAt: true,
      },
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

    // A session stranded in FINALIZING is cancellable once it is plainly not
    // in flight any more. Without this the "cancel it and start another"
    // control on the conflict screen is offered but always fails, which is
    // worse than not offering it: the patient is told there is a way out and
    // then finds there is not.
    //
    // The staleness check is what keeps this safe. Cancelling a finalization
    // that started moments ago would race the finalizer; after thirty seconds
    // there is nothing left to race.
    const isStrandedFinalizing =
      session.status === SessionStatus.FINALIZING &&
      Date.now() - session.updatedAt.getTime() > FINALIZING_STALE_MS;

    if (
      session.status !== SessionStatus.CREATED &&
      session.status !== SessionStatus.ACTIVE &&
      !isStrandedFinalizing
    ) {
      throw AppError.badRequest(
        AppErrorCode.SESSION_INVALID_STATE,
        session.status === SessionStatus.FINALIZING
          ? 'This session is being finished right now. Give it a moment and try again.'
          : `A ${session.status.toLowerCase()} session cannot be cancelled.`,
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
  async sweepStaleSessions(): Promise<{
    cancelled: number;
    failed: number;
    finalized: number;
  }> {
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

    // Stranded finalizations are FINISHED, not failed.
    //
    // They are handled before - and separately from - the ACTIVE cap, on their
    // own much shorter clock. A session only reaches FINALIZING because the
    // patient asked to complete it, so its repetitions are already recorded
    // and the report can still be built from them. Sweeping it to FAILED with
    // everything else would throw away a finished piece of work and show the
    // patient a system error for a session they completed.
    const strandedCutoff = new Date(Date.now() - FINALIZING_STALE_MS);
    const stranded = await this.prisma.exerciseSession.findMany({
      where: {
        status: SessionStatus.FINALIZING,
        updatedAt: { lt: strandedCutoff },
      },
      select: { id: true },
    });
    for (const session of stranded) {
      await this.finalizeStranded(session.id);
    }

    // An ACTIVE session past the hard cap is a system fault (a socket that
    // never closed), not a patient decision - so FAILED, not CANCELLED.
    // FINALIZING is no longer swept here: anything still in it after the pass
    // above could not be finalized and has already been marked FAILED.
    const failed = await this.prisma.exerciseSession.updateMany({
      where: {
        status: SessionStatus.ACTIVE,
        startedAt: { lt: activeCutoff },
      },
      data: { status: SessionStatus.FAILED, endedAt: new Date() },
    });

    if (cancelled.count || failed.count || stranded.length) {
      this.logger.log(
        `Swept stale sessions: ${cancelled.count} cancelled, ` +
          `${failed.count} failed, ${stranded.length} stranded finalization(s) resolved`,
      );
    }

    return {
      cancelled: cancelled.count,
      failed: failed.count,
      finalized: stranded.length,
    };
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
