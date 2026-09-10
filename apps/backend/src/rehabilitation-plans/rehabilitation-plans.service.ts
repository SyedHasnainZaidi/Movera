import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma, PlanStatus, UserRole } from '@prisma/client';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
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
