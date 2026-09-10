import { Injectable } from '@nestjs/common';
import { AssignmentStatus, LinkStatus, SessionStatus } from '@prisma/client';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
  ) {}

  async getOwnProfile(user: AuthUser) {
    const patientProfileId = this.access.requirePatientProfileId(user);
    return this.getProfileById(user, patientProfileId);
  }

  /**
   * Also serves the therapist's patient-detail screen, which is why it goes
   * through assertCanAccessPatient rather than trusting the caller.
   */
  async getProfileById(user: AuthUser, patientProfileId: string) {
    await this.access.assertCanAccessPatient(user, patientProfileId);

    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            timezone: true,
          },
        },
        therapists: {
          where: { status: LinkStatus.ACTIVE },
          include: {
            therapist: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        plans: {
          where: { status: 'ACTIVE' },
          take: 1,
          include: {
            therapist: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    if (!profile) {
      throw AppError.notFound(
        AppErrorCode.PROFILE_NOT_FOUND,
        'Patient profile not found.',
      );
    }

    return {
      id: profile.id,
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      email: profile.user.email,
      timezone: profile.user.timezone,
      dateOfBirth: profile.dateOfBirth?.toISOString() ?? null,
      phone: profile.phone,
      conditionSummary: profile.conditionSummary,
      therapists: profile.therapists.map((link) => ({
        therapistProfileId: link.therapistId,
        name: `${link.therapist.user.firstName} ${link.therapist.user.lastName}`,
        specialization: link.therapist.specialization,
        isPrimary: link.isPrimary,
      })),
      activePlan: profile.plans[0]
        ? {
            id: profile.plans[0].id,
            title: profile.plans[0].title,
            goals: profile.plans[0].goals,
            startDate: profile.plans[0].startDate.toISOString(),
            endDate: profile.plans[0].endDate?.toISOString() ?? null,
            therapistName: `${profile.plans[0].therapist.user.firstName} ${profile.plans[0].therapist.user.lastName}`,
          }
        : null,
    };
  }

  async updateOwnProfile(
    user: AuthUser,
    data: {
      phone?: string;
      dateOfBirth?: string;
      conditionSummary?: string;
      timezone?: string;
    },
  ) {
    const patientProfileId = this.access.requirePatientProfileId(user);

    await this.prisma.$transaction(async (tx) => {
      await tx.patientProfile.update({
        where: { id: patientProfileId },
        data: {
          phone: data.phone,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
          conditionSummary: data.conditionSummary,
        },
      });
      if (data.timezone) {
        await tx.user.update({
          where: { id: user.userId },
          data: { timezone: data.timezone },
        });
      }
    });

    return this.getOwnProfile(user);
  }

  /** Everything the patient's home screen needs, in one round trip. */
  async dashboard(user: AuthUser) {
    const patientProfileId = this.access.requirePatientProfileId(user);

    const [assignments, recentSessions, stats, unreadCount, feedback] =
      await Promise.all([
        this.prisma.exerciseAssignment.findMany({
          where: {
            patientId: patientProfileId,
            status: AssignmentStatus.ACTIVE,
          },
          orderBy: { createdAt: 'desc' },
          include: {
            exercise: {
              select: {
                slug: true,
                name: true,
                category: true,
                difficulty: true,
                targetBodyArea: true,
                recommendedView: true,
                goalType: true,
                defaultHoldSeconds: true,
              },
            },
          },
        }),
        this.prisma.exerciseSession.findMany({
          where: {
            patientId: patientProfileId,
            status: SessionStatus.COMPLETED,
          },
          orderBy: { startedAt: 'desc' },
          take: 5,
          include: { exercise: { select: { name: true, slug: true } } },
        }),
        this.prisma.exerciseSession.aggregate({
          where: {
            patientId: patientProfileId,
            status: SessionStatus.COMPLETED,
          },
          _count: true,
          _avg: { performanceScore: true },
          _sum: { totalReps: true, correctReps: true },
        }),
        this.prisma.notification.count({
          where: { userId: user.userId, read: false },
        }),
        this.prisma.therapistFeedback.findMany({
          where: { patientId: patientProfileId },
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: {
            therapist: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        }),
      ]);

    const today = new Date();
    // ISO weekday: 1 = Monday .. 7 = Sunday. getDay() returns 0 for Sunday.
    const isoWeekday = today.getDay() === 0 ? 7 : today.getDay();

    return {
      stats: {
        totalSessions: stats._count,
        averageScore:
          stats._avg.performanceScore !== null
            ? Math.round(stats._avg.performanceScore * 10) / 10
            : null,
        totalReps: stats._sum.totalReps ?? 0,
        correctReps: stats._sum.correctReps ?? 0,
        activeAssignments: assignments.length,
      },
      assignments: assignments.map((a) => ({
        id: a.id,
        exercise: a.exercise,
        targetSets: a.targetSets,
        repsPerSet: a.repsPerSet,
        targetTotalReps: a.targetSets * a.repsPerSet,
        // Resolved against the exercise default, exactly as
        // ExerciseAssignmentsService.toDto does, so the dashboard and the
        // exercise list cannot disagree about the same prescription.
        goalType: a.exercise.goalType,
        holdSeconds: a.holdSeconds ?? a.exercise.defaultHoldSeconds ?? null,
        difficulty: a.difficulty,
        instructions: a.instructions,
        scheduledDays: a.scheduledDays,
        scheduledToday:
          a.scheduledDays.length === 0 || a.scheduledDays.includes(isoWeekday),
        startDate: a.startDate.toISOString(),
        endDate: a.endDate?.toISOString() ?? null,
      })),
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        exercise: s.exercise,
        startedAt: s.startedAt.toISOString(),
        // See the therapist dashboard: a held session records no repetitions,
        // so a rep-only summary describes it as a failure.
        goalType: s.goalType,
        totalReps: s.totalReps,
        targetTotalReps: s.targetTotalReps,
        heldSec: s.heldSec,
        targetHoldSec: s.targetHoldSec,
        correctReps: s.correctReps,
        performanceScore: s.performanceScore,
      })),
      unreadNotifications: unreadCount,
      recentFeedback: feedback.map((f) => ({
        id: f.id,
        type: f.type,
        body: f.body,
        createdAt: f.createdAt.toISOString(),
        therapistName: `${f.therapist.user.firstName} ${f.therapist.user.lastName}`,
      })),
    };
  }

  /**
   * Deterministic progress metrics.
   *
   * Counts, averages and a per-session timeline. No model, no prediction -
   * calling this "AI" would be false, and the distinction is stated in the
   * response so the UI cannot blur it either.
   */
  async progress(user: AuthUser, patientProfileId: string) {
    await this.access.assertCanAccessPatient(user, patientProfileId);

    const sessions = await this.prisma.exerciseSession.findMany({
      where: { patientId: patientProfileId, status: SessionStatus.COMPLETED },
      orderBy: { startedAt: 'asc' },
      include: { exercise: { select: { slug: true, name: true } } },
    });

    const timeline = sessions.map((s) => ({
      sessionId: s.id,
      date: s.startedAt.toISOString(),
      exercise: s.exercise.name,
      exerciseSlug: s.exercise.slug,
      performanceScore: s.performanceScore ?? 0,
      totalReps: s.totalReps,
      correctReps: s.correctReps,
      targetTotalReps: s.targetTotalReps,
      completionRatio:
        s.targetTotalReps > 0
          ? Math.round((s.totalReps / s.targetTotalReps) * 1000) / 10
          : 0,
    }));

    const byExercise = new Map<
      string,
      { name: string; scores: number[]; reps: number; correct: number }
    >();
    for (const s of sessions) {
      const entry = byExercise.get(s.exercise.slug) ?? {
        name: s.exercise.name,
        scores: [],
        reps: 0,
        correct: 0,
      };
      if (s.performanceScore !== null) entry.scores.push(s.performanceScore);
      entry.reps += s.totalReps;
      entry.correct += s.correctReps;
      byExercise.set(s.exercise.slug, entry);
    }

    const errorCounts = await this.prisma.sessionError.groupBy({
      by: ['code'],
      where: { session: { patientId: patientProfileId } },
      _sum: { occurrences: true },
      orderBy: { _sum: { occurrences: 'desc' } },
      take: 5,
    });

    const totalReps = sessions.reduce((sum, s) => sum + s.totalReps, 0);
    const correctReps = sessions.reduce((sum, s) => sum + s.correctReps, 0);
    const scores = sessions
      .map((s) => s.performanceScore)
      .filter((v): v is number => v !== null);

    return {
      summary: {
        totalSessions: sessions.length,
        totalReps,
        correctReps,
        incorrectReps: totalReps - correctReps,
        correctRepRatio:
          totalReps > 0
            ? Math.round((correctReps / totalReps) * 1000) / 10
            : 0,
        averageScore:
          scores.length > 0
            ? Math.round(
                (scores.reduce((a, b) => a + b, 0) / scores.length) * 10,
              ) / 10
            : null,
        firstSessionAt: sessions[0]?.startedAt.toISOString() ?? null,
        lastSessionAt:
          sessions[sessions.length - 1]?.startedAt.toISOString() ?? null,
      },
      timeline,
      byExercise: [...byExercise.entries()].map(([slug, entry]) => ({
        slug,
        name: entry.name,
        sessions: entry.scores.length,
        averageScore:
          entry.scores.length > 0
            ? Math.round(
                (entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length) *
                  10,
              ) / 10
            : null,
        totalReps: entry.reps,
        correctReps: entry.correct,
      })),
      recurringIssues: errorCounts.map((e) => ({
        code: e.code,
        occurrences: e._sum.occurrences ?? 0,
      })),
      methodology:
        'Deterministic aggregation of stored session results. These are counts and averages, not machine-learning predictions.',
    };
  }
}
