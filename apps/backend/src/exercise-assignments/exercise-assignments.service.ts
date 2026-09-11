import { Injectable, Logger } from '@nestjs/common';
import {
  AssignmentStatus,
  ExerciseGoalType,
  NotificationType,
  PlanStatus,
  Prisma,
  SessionStatus,
  UserRole,
} from '@prisma/client';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { LIVE_STATUSES } from '../sessions/sessions.service';
import type {
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from './dto/exercise-assignments.dto';

/**
 * The exercise fields every assignment response needs.
 *
 * goalType and defaultHoldSeconds are here because toDto resolves the
 * prescription: a HOLD assignment with a null holdSeconds falls back to the
 * exercise default, and doing that once here beats every screen re-deriving it.
 */
const EXERCISE_GOAL_SELECT = {
  slug: true,
  name: true,
  goalType: true,
  defaultHoldSeconds: true,
} as const;

@Injectable()
export class ExerciseAssignmentsService {
  private readonly logger = new Logger(ExerciseAssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly email: EmailService,
  ) {}

  async create(user: AuthUser, dto: CreateAssignmentDto) {
    // The link check is the whole security story for this endpoint: without it
    // a therapist could prescribe exercises to any patient in the system, which
    // is exactly what the superseded Express prototype allowed.
    const therapistProfileId = await this.access.assertCanManagePatient(
      user,
      dto.patientId,
    );

    const exercise = await this.prisma.exercise.findUnique({
      where: { id: dto.exerciseId },
      include: { ruleConfigs: { where: { isActive: true }, select: { id: true } } },
    });
    if (!exercise) {
      throw AppError.notFound(
        AppErrorCode.EXERCISE_NOT_FOUND,
        'That exercise does not exist.',
      );
    }
    if (!exercise.isActive) {
      throw AppError.badRequest(
        AppErrorCode.EXERCISE_INACTIVE,
        'That exercise is no longer available for prescription.',
      );
    }
    if (exercise.ruleConfigs.length === 0) {
      throw AppError.badRequest(
        AppErrorCode.RULE_CONFIG_MISSING,
        'That exercise has no active analysis configuration and cannot be assigned yet.',
      );
    }

    // Every exercise belongs to a plan. A prescription with no plan behind it
    // has no stated goal, no start and end date and no clinical context, which
    // is how the superseded prototype let exercises accumulate on a patient as
    // an unexplained list. The plan must also still be ACTIVE - assigning into
    // one the therapist has already completed or cancelled would put work in
    // front of the patient that the plan says is finished.
    const plan = await this.prisma.rehabilitationPlan.findUnique({
      where: { id: dto.planId },
      select: { patientId: true, status: true, title: true },
    });
    if (!plan || plan.patientId !== dto.patientId) {
      throw AppError.badRequest(
        AppErrorCode.PLAN_NOT_FOUND,
        'That plan does not belong to this patient.',
      );
    }
    if (plan.status !== PlanStatus.ACTIVE) {
      throw AppError.badRequest(
        AppErrorCode.PLAN_NOT_ACTIVE,
        `"${plan.title}" is ${plan.status.toLowerCase()}, so exercises cannot be added to it. Reactivate it or create a new plan first.`,
      );
    }

    const assignment = await this.prisma.exerciseAssignment.create({
      data: {
        planId: dto.planId,
        patientId: dto.patientId,
        therapistId: therapistProfileId,
        exerciseId: dto.exerciseId,
        targetSets: dto.targetSets,
        repsPerSet: dto.repsPerSet,
        // Stored only for a HOLD exercise. Accepting it on a REPS exercise
        // would leave a number in the record that nothing ever reads, which
        // later looks like a prescription that was ignored.
        holdSeconds:
          exercise.goalType === ExerciseGoalType.HOLD
            ? (dto.holdSeconds ?? exercise.defaultHoldSeconds ?? null)
            : null,
        difficulty: dto.difficulty,
        frequencyPerWeek: dto.frequencyPerWeek,
        scheduledDays: dto.scheduledDays ?? [],
        preferredTime: dto.preferredTime,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        instructions: dto.instructions,
      },
      include: { exercise: { select: EXERCISE_GOAL_SELECT } },
    });

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: dto.patientId },
      select: {
        userId: true,
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    // A hold exercise has no sets or repetitions, so it must not be announced
    // as having any - the patient would arrive expecting to count something.
    const isHold = exercise.goalType === ExerciseGoalType.HOLD;
    const prescriptionText = isHold
      ? `hold correct alignment for ${assignment.holdSeconds ?? 0} seconds in total`
      : `${dto.targetSets} sets of ${dto.repsPerSet} repetitions`;

    if (patient) {
      await this.prisma.notification.create({
        data: {
          userId: patient.userId,
          type: NotificationType.ASSIGNMENT_CREATED,
          title: 'New exercise assigned',
          message: `${assignment.exercise.name}: ${prescriptionText}.`,
          payload: { assignmentId: assignment.id },
        },
      });

      // Email in addition to the in-app notification. The patient is not
      // expected to be looking at the app when their therapist prescribes
      // something, which is the whole point of sending one.
      const therapist = await this.prisma.therapistProfile.findUnique({
        where: { id: therapistProfileId },
        select: { user: { select: { firstName: true, lastName: true } } },
      });

      await this.email.sendExerciseAssigned({
        to: patient.user.email,
        patientName: `${patient.user.firstName} ${patient.user.lastName}`,
        therapistName: therapist
          ? `${therapist.user.firstName} ${therapist.user.lastName}`
          : 'your therapist',
        exerciseName: assignment.exercise.name,
        dueDate: assignment.endDate,
        prescription: prescriptionText,
      });
    }

    this.logger.log(
      `Assignment ${assignment.id} (${assignment.exercise.slug}) created for patient ${dto.patientId}`,
    );
    return this.toDto(assignment);
  }

  async update(user: AuthUser, assignmentId: string, dto: UpdateAssignmentDto) {
    const assignment = await this.prisma.exerciseAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, patientId: true },
    });
    if (!assignment) {
      throw AppError.notFound(
        AppErrorCode.ASSIGNMENT_NOT_FOUND,
        'Assignment not found.',
      );
    }
    await this.access.assertCanManagePatient(user, assignment.patientId);

    const updated = await this.prisma.exerciseAssignment.update({
      where: { id: assignmentId },
      data: {
        targetSets: dto.targetSets,
        repsPerSet: dto.repsPerSet,
        holdSeconds: dto.holdSeconds,
        difficulty: dto.difficulty,
        frequencyPerWeek: dto.frequencyPerWeek,
        scheduledDays: dto.scheduledDays,
        preferredTime: dto.preferredTime,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        instructions: dto.instructions,
        status: dto.status,
      },
      include: { exercise: { select: EXERCISE_GOAL_SELECT } },
    });

    return this.toDto(updated);
  }

  /**
   * Remove an assignment from the patient's list.
   *
   * Two outcomes, chosen by the data rather than by a flag, because a
   * therapist tidying up a list should not have to understand the difference:
   *
   *   * **No sessions recorded** - the row is genuinely DELETED. Nothing
   *     clinical is lost because nothing clinical happened; it was a
   *     mis-prescription, a duplicate, or something the patient never started.
   *
   *   * **Sessions exist** - the row is ARCHIVED (status CANCELLED) and kept.
   *     Deleting it would orphan or destroy completed sessions, repetition
   *     records and reports that the patient and therapist may need later, and
   *     a rehabilitation record that silently loses history is worse than a
   *     tidy list is good. It disappears from the active list either way.
   *
   * The response says which happened, so the UI can tell the truth rather than
   * claiming a deletion that did not occur.
   *
   * A live session blocks both: the patient is mid-exercise.
   */
  async remove(user: AuthUser, assignmentId: string) {
    const assignment = await this.prisma.exerciseAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        patientId: true,
        status: true,
        exercise: { select: { name: true } },
      },
    });
    if (!assignment) {
      throw AppError.notFound(
        AppErrorCode.ASSIGNMENT_NOT_FOUND,
        'Assignment not found.',
      );
    }
    await this.access.assertCanManagePatient(user, assignment.patientId);

    const live = await this.prisma.exerciseSession.findFirst({
      where: { assignmentId, status: { in: LIVE_STATUSES } },
      select: { id: true },
    });
    if (live) {
      throw AppError.conflict(
        AppErrorCode.SESSION_ALREADY_LIVE,
        'The patient is currently doing this exercise. Wait for the session to ' +
          'finish, then remove it.',
      );
    }

    const sessionCount = await this.prisma.exerciseSession.count({
      where: { assignmentId },
    });

    if (sessionCount === 0) {
      await this.prisma.exerciseAssignment.delete({
        where: { id: assignmentId },
      });
      this.logger.log(
        `Assignment ${assignmentId} deleted (no recorded sessions)`,
      );
      return {
        id: assignmentId,
        deleted: true,
        archived: false,
        sessionCount: 0,
        status: null,
        message: `"${assignment.exercise.name}" was removed. It had no recorded sessions, so nothing was kept.`,
      };
    }

    const archived = await this.prisma.exerciseAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.CANCELLED },
      include: { exercise: { select: EXERCISE_GOAL_SELECT } },
    });
    this.logger.log(
      `Assignment ${assignmentId} archived; ${sessionCount} session(s) retained`,
    );

    return {
      id: assignmentId,
      deleted: false,
      archived: true,
      sessionCount,
      status: archived.status,
      message:
        `"${assignment.exercise.name}" was archived rather than deleted: it has ` +
        `${sessionCount} recorded session${sessionCount === 1 ? '' : 's'}, and ` +
        `that history is kept. The patient can no longer start it.`,
    };
  }

  /** Role-scoped: a patient sees only their own assignments. */
  async list(
    user: AuthUser,
    filters: { patientId?: string; status?: AssignmentStatus },
  ) {
    let where: Prisma.ExerciseAssignmentWhereInput;

    if (user.role === UserRole.PATIENT) {
      where = { patientId: this.access.requirePatientProfileId(user) };
    } else {
      const therapistProfileId = this.access.requireTherapistProfileId(user);
      if (filters.patientId) {
        await this.access.assertCanAccessPatient(user, filters.patientId);
        where = { patientId: filters.patientId };
      } else {
        where = {
          patientId: {
            in: await this.access.managedPatientIds(therapistProfileId),
          },
        };
      }
    }

    if (filters.status) {
      where.status = filters.status;
    }

    const assignments = await this.prisma.exerciseAssignment.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        exercise: {
          select: {
            ...EXERCISE_GOAL_SELECT,
            category: true,
            difficulty: true,
            targetBodyArea: true,
            recommendedView: true,
          },
        },
        plan: { select: { id: true, title: true } },
        _count: { select: { sessions: true } },
      },
    });

    return assignments.map((a) => this.toDto(a));
  }

  async findOne(user: AuthUser, assignmentId: string) {
    const assignment = await this.prisma.exerciseAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        exercise: true,
        plan: { select: { id: true, title: true, status: true } },
        therapist: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!assignment) {
      throw AppError.notFound(
        AppErrorCode.ASSIGNMENT_NOT_FOUND,
        'Assignment not found.',
      );
    }
    await this.access.assertCanAccessPatient(user, assignment.patientId);

    const completedSessions = await this.prisma.exerciseSession.count({
      where: { assignmentId, status: SessionStatus.COMPLETED },
    });

    return {
      ...this.toDto(assignment),
      instructions: assignment.instructions,
      exerciseDetail: {
        slug: assignment.exercise.slug,
        name: assignment.exercise.name,
        description: assignment.exercise.description,
        instructions: assignment.exercise.instructions,
        recommendedView: assignment.exercise.recommendedView,
        framingInstructions: assignment.exercise.framingInstructions,
        targetBodyArea: assignment.exercise.targetBodyArea,
        goalType: assignment.exercise.goalType,
      },
      therapistName: `${assignment.therapist.user.firstName} ${assignment.therapist.user.lastName}`,
      completedSessions,
    };
  }

  private toDto(assignment: {
    id: string;
    patientId: string;
    therapistId: string;
    planId: string | null;
    targetSets: number;
    repsPerSet: number;
    holdSeconds: number | null;
    difficulty: string;
    frequencyPerWeek: number | null;
    scheduledDays: number[];
    preferredTime: string | null;
    startDate: Date;
    endDate: Date | null;
    instructions: string | null;
    status: AssignmentStatus;
    exercise?: { slug: string; name: string } & Record<string, unknown>;
    plan?: { id: string; title: string } | null;
    _count?: { sessions: number };
  }) {
    return {
      id: assignment.id,
      patientId: assignment.patientId,
      therapistId: assignment.therapistId,
      planId: assignment.planId,
      exercise: assignment.exercise ?? null,
      plan: assignment.plan ?? null,
      targetSets: assignment.targetSets,
      repsPerSet: assignment.repsPerSet,
      // Derived once, here, so the number can never disagree between screens.
      targetTotalReps: assignment.targetSets * assignment.repsPerSet,
      // How this assignment is actually measured. A HOLD exercise carries
      // sets and reps because the columns are NOT NULL, so every screen has
      // to read goalType before believing them.
      goalType: assignment.exercise?.goalType ?? null,
      // Falls back to the exercise default, so a therapist who left it blank
      // still gets a real prescription rather than a null the UI has to guess
      // about. Resolved here, once, for the same reason targetTotalReps is.
      holdSeconds:
        assignment.holdSeconds ??
        (assignment.exercise?.defaultHoldSeconds as number | null | undefined) ??
        null,
      difficulty: assignment.difficulty,
      frequencyPerWeek: assignment.frequencyPerWeek,
      scheduledDays: assignment.scheduledDays,
      preferredTime: assignment.preferredTime,
      startDate: assignment.startDate.toISOString(),
      endDate: assignment.endDate?.toISOString() ?? null,
      instructions: assignment.instructions,
      status: assignment.status,
      // Present only where it was queried. Drives the therapist UI: an
      // assignment with sessions is archived on removal rather than deleted,
      // and the confirmation prompt has to say so accurately.
      sessionCount: assignment._count?.sessions ?? null,
    };
  }
}
