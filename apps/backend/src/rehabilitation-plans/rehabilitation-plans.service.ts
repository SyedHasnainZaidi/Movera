import { Injectable, Logger } from '@nestjs/common';
import {
  AssignmentStatus,
  NotificationType,
  Prisma,
  PlanStatus,
  UserRole,
} from '@prisma/client';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { LIVE_STATUSES } from '../sessions/sessions.service';
import type {
  CreatePlanDto,
  UpdatePlanDto,
} from './dto/rehabilitation-plans.dto';

@Injectable()
export class RehabilitationPlansService {
  private readonly logger = new Logger(RehabilitationPlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
  ) {}

  /**
   * Create a plan for a linked patient.
   *
   * At most one ACTIVE plan per patient. Enforced in two places on purpose:
   * this transaction gives a clean 409, and a partial unique index in
   * migration 20260828040000 makes it impossible even under a race that
   * defeats the application check.
   */
  async create(user: AuthUser, dto: CreatePlanDto) {
    const therapistProfileId = await this.access.assertCanManagePatient(
      user,
      dto.patientId,
    );

    const plan = await this.prisma.$transaction(async (tx) => {
      if (dto.status !== PlanStatus.DRAFT) {
        const existing = await tx.rehabilitationPlan.findFirst({
          where: { patientId: dto.patientId, status: PlanStatus.ACTIVE },
          select: { id: true, title: true },
        });
        if (existing) {
          throw AppError.conflict(
            AppErrorCode.ACTIVE_PLAN_EXISTS,
            `This patient already has an active plan ("${existing.title}"). Complete or cancel it first.`,
          );
        }
      }

      return tx.rehabilitationPlan.create({
        data: {
          patientId: dto.patientId,
          therapistId: therapistProfileId,
          title: dto.title,
          goals: dto.goals,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          status: dto.status ?? PlanStatus.ACTIVE,
          notes: dto.notes,
        },
      });
    });

    await this.notifyPatient(
      dto.patientId,
      'New rehabilitation plan',
      `Your physiotherapist created the plan "${plan.title}".`,
      { planId: plan.id },
    );

    this.logger.log(`Plan ${plan.id} created for patient ${dto.patientId}`);
    return this.toDto(plan);
  }

  async update(user: AuthUser, planId: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.rehabilitationPlan.findUnique({
      where: { id: planId },
      select: { id: true, patientId: true, status: true, title: true },
    });
    if (!plan) {
      throw AppError.notFound(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found.');
    }
    await this.access.assertCanManagePatient(user, plan.patientId);

    // Reactivating a plan must respect the one-active-plan rule too.
    if (dto.status === PlanStatus.ACTIVE && plan.status !== PlanStatus.ACTIVE) {
      const existing = await this.prisma.rehabilitationPlan.findFirst({
        where: {
          patientId: plan.patientId,
          status: PlanStatus.ACTIVE,
          id: { not: planId },
        },
        select: { title: true },
      });
      if (existing) {
        throw AppError.conflict(
          AppErrorCode.ACTIVE_PLAN_EXISTS,
          `This patient already has an active plan ("${existing.title}").`,
        );
      }
    }

    const updated = await this.prisma.rehabilitationPlan.update({
      where: { id: planId },
      data: {
        title: dto.title,
        goals: dto.goals,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        status: dto.status,
        notes: dto.notes,
      },
    });

    await this.notifyPatient(
      plan.patientId,
      'Rehabilitation plan updated',
      `Your physiotherapist updated "${updated.title}".`,
      { planId },
      NotificationType.PLAN_UPDATED,
    );

    return this.toDto(updated);
  }

  /**
   * Remove a plan from the patient's record.
   *
   * Two outcomes, chosen by the data rather than by a flag - the same rule the
   * assignment endpoint uses, applied one level up:
   *
   *   * **No sessions anywhere under the plan** - the plan and its assignments
   *     are genuinely DELETED. Nothing clinical is lost because nothing
   *     clinical happened: it was a mis-prescription, a duplicate, or a plan
   *     the patient never started.
   *
   *   * **Sessions exist** - the plan and its assignments are ARCHIVED
   *     (CANCELLED) and kept. Deleting would destroy completed sessions,
   *     repetition records and reports that form the patient's rehabilitation
   *     history, and a tidy-up must never cost a clinical record.
   *
   * The plan is treated as a unit. Deleting only its session-free assignments
   * and cancelling the rest would leave a half-dismantled plan that is harder
   * to reason about than either whole outcome.
   *
   * The assignments are handled EXPLICITLY rather than left to the schema's
   * `onDelete: SetNull`. That default would strand them with a null planId -
   * which, now that every assignment must belong to a plan, is precisely the
   * state this endpoint must not create.
   */
  async remove(user: AuthUser, planId: string) {
    const plan = await this.prisma.rehabilitationPlan.findUnique({
      where: { id: planId },
      select: { id: true, patientId: true, title: true, status: true },
    });
    if (!plan) {
      throw AppError.notFound(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found.');
    }
    await this.access.assertCanManagePatient(user, plan.patientId);

    // A session in flight is writing to one of these assignments right now.
    // Removing the plan underneath it would strand that session.
    const live = await this.prisma.exerciseSession.findFirst({
      where: { assignment: { planId }, status: { in: LIVE_STATUSES } },
      select: { id: true },
    });
    if (live) {
      throw AppError.conflict(
        AppErrorCode.SESSION_ALREADY_LIVE,
        'The patient is part-way through an exercise in this plan. Wait for ' +
          'the session to finish, then remove it.',
      );
    }

    const sessionCount = await this.prisma.exerciseSession.count({
      where: { assignment: { planId } },
    });

    if (sessionCount === 0) {
      await this.prisma.$transaction([
        this.prisma.exerciseAssignment.deleteMany({ where: { planId } }),
        this.prisma.rehabilitationPlan.delete({ where: { id: planId } }),
      ]);
      this.logger.log(`Plan ${planId} deleted (no recorded sessions)`);

      await this.notifyPatient(
        plan.patientId,
        'Rehabilitation plan removed',
        `Your physiotherapist removed the plan "${plan.title}".`,
        { planId },
      );

      return {
        id: planId,
        deleted: true,
        status: null,
        message: `"${plan.title}" was removed. It had no recorded sessions, so nothing was archived.`,
      };
    }

    await this.prisma.$transaction([
      this.prisma.exerciseAssignment.updateMany({
        where: { planId, status: { not: AssignmentStatus.CANCELLED } },
        data: { status: AssignmentStatus.CANCELLED },
      }),
      this.prisma.rehabilitationPlan.update({
        where: { id: planId },
        data: { status: PlanStatus.CANCELLED },
      }),
    ]);
    this.logger.log(
      `Plan ${planId} archived (CANCELLED) - ${sessionCount} session(s) kept`,
    );

    await this.notifyPatient(
      plan.patientId,
      'Rehabilitation plan ended',
      `Your physiotherapist ended the plan "${plan.title}". Your completed sessions and reports are still available.`,
      { planId },
    );

    return {
      id: planId,
      deleted: false,
      status: PlanStatus.CANCELLED,
      message: `"${plan.title}" was archived. ${sessionCount} recorded session${
        sessionCount === 1 ? '' : 's'
      } and the reports built from them were kept.`,
    };
  }

  /** Role-scoped listing: patients see their own, therapists see their caseload. */
  async list(user: AuthUser, patientProfileId?: string) {
    let where: Prisma.RehabilitationPlanWhereInput;

    if (user.role === UserRole.PATIENT) {
      where = { patientId: this.access.requirePatientProfileId(user) };
    } else {
      const therapistProfileId = this.access.requireTherapistProfileId(user);
      if (patientProfileId) {
        await this.access.assertCanAccessPatient(user, patientProfileId);
        where = { patientId: patientProfileId };
      } else {
        where = { patientId: { in: await this.access.managedPatientIds(therapistProfileId) } };
      }
    }

    const plans = await this.prisma.rehabilitationPlan.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      include: {
        therapist: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
        patient: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
        _count: { select: { assignments: true } },
      },
    });

    return plans.map((plan) => ({
      ...this.toDto(plan),
      therapistName: `${plan.therapist.user.firstName} ${plan.therapist.user.lastName}`,
      patientName: `${plan.patient.user.firstName} ${plan.patient.user.lastName}`,
      assignmentCount: plan._count.assignments,
    }));
  }

  async findOne(user: AuthUser, planId: string) {
    const plan = await this.prisma.rehabilitationPlan.findUnique({
      where: { id: planId },
      include: {
        assignments: {
          include: {
            exercise: {
              select: { slug: true, name: true, category: true, difficulty: true },
            },
          },
        },
        therapist: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!plan) {
      throw AppError.notFound(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found.');
    }
    await this.access.assertCanAccessPatient(user, plan.patientId);

    return {
      ...this.toDto(plan),
      therapistName: `${plan.therapist.user.firstName} ${plan.therapist.user.lastName}`,
      assignments: plan.assignments.map((a) => ({
        id: a.id,
        exercise: a.exercise,
        targetSets: a.targetSets,
        repsPerSet: a.repsPerSet,
        difficulty: a.difficulty,
        status: a.status,
        scheduledDays: a.scheduledDays,
      })),
    };
  }

  private toDto(plan: {
    id: string;
    patientId: string;
    therapistId: string;
    title: string;
    goals: string | null;
    startDate: Date;
    endDate: Date | null;
    status: PlanStatus;
    notes: string | null;
  }) {
    return {
      id: plan.id,
      patientId: plan.patientId,
      therapistId: plan.therapistId,
      title: plan.title,
      goals: plan.goals,
      startDate: plan.startDate.toISOString(),
      endDate: plan.endDate?.toISOString() ?? null,
      status: plan.status,
      notes: plan.notes,
    };
  }

  private async notifyPatient(
    patientProfileId: string,
    title: string,
    message: string,
    payload: Record<string, string>,
    type: NotificationType = NotificationType.PLAN_UPDATED,
  ): Promise<void> {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
      select: { userId: true },
    });
    if (!patient) return;
    await this.prisma.notification.create({
      data: { userId: patient.userId, type, title, message, payload },
    });
  }
}
