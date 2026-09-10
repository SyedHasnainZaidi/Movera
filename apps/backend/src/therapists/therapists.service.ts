import { Injectable, Logger } from '@nestjs/common';
import {
  AssignmentStatus,
  LinkStatus,
  NotificationType,
  SessionStatus,
} from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { AccessControlService } from '../common/access/access-control.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { AppConfigService } from '../config/app-config.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Invite codes avoid look-alike characters (no O/0, I/1) because a patient
 * reads this aloud or types it from a screen.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

@Injectable()
export class TherapistsService {
  private readonly logger = new Logger(TherapistsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly config: AppConfigService,
    private readonly email: EmailService,
  ) {}

  // -- invites -------------------------------------------------------------

  /**
   * The PATIENT generates a code and gives it to their therapist.
   *
   * This inverts the superseded prototype, where a therapist could claim any
   * patient by typing their email address - which let anyone who knew an email
   * attach themselves to that person's clinical record. Consent now flows from
   * the patient, and only a SHA-256 hash of the code is stored, so a database
   * leak does not yield usable codes.
   */
  async createLinkInvite(user: AuthUser) {
    const patientProfileId = this.access.requirePatientProfileId(user);

    // Supersede any outstanding invite so only one code is ever live.
    await this.prisma.patientLinkInvite.updateMany({
      where: { patientId: patientProfileId, usedAt: null },
      data: { expiresAt: new Date() },
    });

    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + this.config.inviteCodeTtlMinutes * 60_000,
    );

    await this.prisma.patientLinkInvite.create({
      data: { patientId: patientProfileId, codeHash: hashCode(code), expiresAt },
    });

    this.logger.log(`Link invite created for patient ${patientProfileId}`);

    // The plaintext code is returned exactly once and never stored or logged.
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: this.config.inviteCodeTtlMinutes,
      instructions:
        'Share this code with your physiotherapist. It can be used once and expires.',
    };
  }

  /** Therapist redeems a patient-issued code. */
  async linkPatientByInvite(user: AuthUser, rawCode: string) {
    const therapistProfileId = this.access.requireTherapistProfileId(user);
    const codeHash = hashCode(rawCode.trim().toUpperCase());

    const invite = await this.prisma.patientLinkInvite.findUnique({
      where: { codeHash },
      include: {
        patient: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // Same error for "no such code" and "wrong code" so the endpoint cannot be
    // used to probe which codes exist.
    if (!invite) {
      throw AppError.badRequest(
        AppErrorCode.INVITE_INVALID,
        'That invite code is not valid.',
      );
    }
    // 409 rather than 400 for these two: the code was well-formed and did
    // exist, but the invite's current state conflicts with the request. 400 is
    // reserved for a code that is simply not valid - which keeps the two cases
    // distinguishable by status alone.
    if (invite.usedAt) {
      throw AppError.conflict(
        AppErrorCode.INVITE_ALREADY_USED,
        'That invite code has already been used.',
      );
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw AppError.conflict(
        AppErrorCode.INVITE_EXPIRED,
        'That invite code has expired. Ask your patient for a new one.',
      );
    }

    const existing = await this.prisma.therapistPatient.findUnique({
      where: {
        therapistId_patientId: {
          therapistId: therapistProfileId,
          patientId: invite.patientId,
        },
      },
    });
    if (existing && existing.status === LinkStatus.ACTIVE) {
      throw AppError.conflict(
        AppErrorCode.ALREADY_LINKED,
        'You are already linked to this patient.',
      );
    }

    // Consume the invite and create the link atomically: a crash between the
    // two would either burn the code without linking, or leave it reusable.
    await this.prisma.$transaction(async (tx) => {
      await tx.patientLinkInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedById: therapistProfileId },
      });

      await tx.therapistPatient.upsert({
        where: {
          therapistId_patientId: {
            therapistId: therapistProfileId,
            patientId: invite.patientId,
          },
        },
        create: {
          therapistId: therapistProfileId,
          patientId: invite.patientId,
          status: LinkStatus.ACTIVE,
          isPrimary: true,
        },
        update: {
          status: LinkStatus.ACTIVE,
          unlinkedAt: null,
          linkedAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: invite.patient.user.id,
          type: NotificationType.PATIENT_LINKED,
          title: 'Therapist linked',
          message: 'Your physiotherapist is now connected to your account.',
        },
      });
    });

    this.logger.log(
      `Therapist ${therapistProfileId} linked to patient ${invite.patientId}`,
    );

    const patientName = `${invite.patient.user.firstName} ${invite.patient.user.lastName}`;

    // Both parties are told, by email as well as in-app. Sent after the
    // transaction has committed: the link is a clinical fact and must not
    // depend on a mail server being reachable.
    await this.notifyLinkEstablished({
      therapistProfileId,
      patientProfileId: invite.patientId,
      patientEmail: invite.patient.user.email,
      patientName,
    });

    return {
      patientProfileId: invite.patientId,
      patientName,
      linkedAt: new Date().toISOString(),
    };
  }

  /**
   * Emails both sides of a newly established link.
   *
   * Failures are swallowed by EmailService and logged there, so nothing here
   * can turn a successful link into a failed request.
   */
  private async notifyLinkEstablished(input: {
    therapistProfileId: string;
    patientProfileId: string;
    patientEmail: string;
    patientName: string;
  }): Promise<void> {
    const therapist = await this.prisma.therapistProfile.findUnique({
      where: { id: input.therapistProfileId },
      select: {
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!therapist) return;

    const therapistName = `${therapist.user.firstName} ${therapist.user.lastName}`;

    await Promise.all([
      this.email.sendPatientLinked({
        to: input.patientEmail,
        patientName: input.patientName,
        therapistName,
      }),
      this.email.sendTherapistLinked({
        to: therapist.user.email,
        therapistName,
        patientName: input.patientName,
        patientProfileId: input.patientProfileId,
      }),
    ]);
  }

  async unlinkPatient(user: AuthUser, patientProfileId: string) {
    const therapistProfileId = this.access.requireTherapistProfileId(user);

    const link = await this.prisma.therapistPatient.findUnique({
      where: {
        therapistId_patientId: {
          therapistId: therapistProfileId,
          patientId: patientProfileId,
        },
      },
    });
    if (!link || link.status !== LinkStatus.ACTIVE) {
      throw AppError.notFound(
        AppErrorCode.LINK_NOT_FOUND,
        'You are not linked to this patient.',
      );
    }

    // Soft unlink. Hard-deleting would orphan plans, assignments and sessions -
    // clinical history must survive an administrative change.
    //
    // The link ROW is kept, not just the history: re-linking upserts this same
    // row back to ACTIVE (see linkPatientByInvite), so a returning patient
    // reconnects to their existing record rather than starting a blank one
    // beside it.
    await this.prisma.therapistPatient.update({
      where: { id: link.id },
      data: { status: LinkStatus.INACTIVE, unlinkedAt: new Date() },
    });

    const [patient, sessionCount] = await Promise.all([
      this.prisma.patientProfile.findUnique({
        where: { id: patientProfileId },
        select: {
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.exerciseSession.count({ where: { patientId: patientProfileId } }),
    ]);

    const name = patient
      ? `${patient.user.firstName} ${patient.user.lastName}`
      : 'The patient';

    this.logger.log(
      `Therapist ${therapistProfileId} archived patient ${patientProfileId} ` +
        `(${sessionCount} session(s) retained)`,
    );

    return {
      patientProfileId,
      status: LinkStatus.INACTIVE,
      archivedAt: new Date().toISOString(),
      sessionCount,
      message:
        `${name} has been moved to your archived patients. ` +
        `${sessionCount} recorded session${sessionCount === 1 ? '' : 's'} ` +
        `${sessionCount === 1 ? 'is' : 'are'} kept. You no longer have access ` +
        `to their records; if they return and share a new invite code, the ` +
        `link and the full history come back.`,
    };
  }

  // -- caseload ------------------------------------------------------------

  /**
   * The therapist caseload.
   *
   * `archived` lists patients whose link has been ended rather than the ones
   * currently under care. That view exists so a discharged patient is not
   * simply invisible: the therapist can see the relationship existed, when it
   * ended, and how much history is waiting if the patient ever returns.
   *
   * It deliberately carries NO clinical detail beyond counts. Ending the link
   * ends access to the record - `assertCanAccessPatient` requires an ACTIVE
   * link - and this listing must not become a way around that. Full access
   * returns only when the patient re-links by issuing a new invite code, which
   * is consent given again rather than assumed.
   */
  async listPatients(
    user: AuthUser,
    page: number,
    limit: number,
    scope: 'active' | 'archived' = 'active',
  ) {
    const therapistProfileId = this.access.requireTherapistProfileId(user);

    const where = {
      therapistId: therapistProfileId,
      status: scope === 'archived' ? LinkStatus.INACTIVE : LinkStatus.ACTIVE,
    };

    const [links, total] = await this.prisma.$transaction([
      this.prisma.therapistPatient.findMany({
        where,
        // Archived rows are most useful most-recently-discharged first.
        orderBy:
          scope === 'archived' ? { unlinkedAt: 'desc' } : { linkedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          patient: {
            include: {
              user: {
                select: { firstName: true, lastName: true, email: true },
              },
              plans: {
                where: { status: 'ACTIVE' },
                select: { id: true, title: true },
                take: 1,
              },
              _count: { select: { sessions: true } },
            },
          },
        },
      }),
      this.prisma.therapistPatient.count({ where }),
    ]);

    const rows = await Promise.all(
      links.map(async (link) => {
        const last = await this.prisma.exerciseSession.findFirst({
          where: {
            patientId: link.patientId,
            status: SessionStatus.COMPLETED,
          },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true, performanceScore: true },
        });

        return {
          patientProfileId: link.patientId,
          name: `${link.patient.user.firstName} ${link.patient.user.lastName}`,
          email: link.patient.user.email,
          conditionSummary: link.patient.conditionSummary,
          isPrimary: link.isPrimary,
          linkedAt: link.linkedAt.toISOString(),
          archivedAt: link.unlinkedAt?.toISOString() ?? null,
          activePlan: link.patient.plans[0] ?? null,
          totalSessions: link.patient._count.sessions,
          lastSessionAt: last?.startedAt.toISOString() ?? null,
          lastSessionScore: last?.performanceScore ?? null,
        };
      }),
    );

    return { rows, total };
  }

  async getProfile(user: AuthUser) {
    const therapistProfileId = this.access.requireTherapistProfileId(user);
    const profile = await this.prisma.therapistProfile.findUnique({
      where: { id: therapistProfileId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            timezone: true,
          },
        },
        _count: { select: { patients: true } },
      },
    });

    if (!profile) {
      throw AppError.notFound(
        AppErrorCode.PROFILE_NOT_FOUND,
        'Therapist profile not found.',
      );
    }

    return {
      id: profile.id,
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      email: profile.user.email,
      timezone: profile.user.timezone,
      licenseNumber: profile.licenseNumber,
      specialization: profile.specialization,
      bio: profile.bio,
      yearsExperience: profile.yearsExperience,
      patientCount: profile._count.patients,
      // Stated plainly: this system performs no licence verification.
      licenceNote:
        'Professional details are self-declared and are not verified by this system.',
    };
  }

  async updateProfile(
    user: AuthUser,
    data: {
      licenseNumber?: string;
      specialization?: string;
      bio?: string;
      yearsExperience?: number;
    },
  ) {
    const therapistProfileId = this.access.requireTherapistProfileId(user);
    await this.prisma.therapistProfile.update({
      where: { id: therapistProfileId },
      data,
    });
    return this.getProfile(user);
  }

  // -- dashboard -----------------------------------------------------------

  /**
   * Deterministic caseload metrics. Plain counts and averages over stored
   * sessions - explicitly NOT machine learning, and never described as such.
   */
  async dashboard(user: AuthUser) {
    const therapistProfileId = this.access.requireTherapistProfileId(user);
    const patientIds = await this.access.managedPatientIds(therapistProfileId);

    if (patientIds.length === 0) {
      return {
        caseload: 0,
        activePlans: 0,
        activeAssignments: 0,
        sessionsThisWeek: 0,
        averageScore: null,
        recentSessions: [],
        patientsNeedingReview: [],
      };
    }

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [activePlans, activeAssignments, sessionsThisWeek, scoreAgg] =
      await this.prisma.$transaction([
        this.prisma.rehabilitationPlan.count({
          where: { patientId: { in: patientIds }, status: 'ACTIVE' },
        }),
        this.prisma.exerciseAssignment.count({
          where: {
            patientId: { in: patientIds },
            status: AssignmentStatus.ACTIVE,
          },
        }),
        this.prisma.exerciseSession.count({
          where: {
            patientId: { in: patientIds },
            status: SessionStatus.COMPLETED,
            startedAt: { gte: weekAgo },
          },
        }),
        this.prisma.exerciseSession.aggregate({
          where: {
            patientId: { in: patientIds },
            status: SessionStatus.COMPLETED,
          },
          _avg: { performanceScore: true },
        }),
      ]);

    const recentSessions = await this.prisma.exerciseSession.findMany({
      where: {
        patientId: { in: patientIds },
        status: SessionStatus.COMPLETED,
      },
      orderBy: { startedAt: 'desc' },
      take: 8,
      include: {
        exercise: { select: { name: true } },
        patient: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    // "Needs review" = no completed session in 7 days. A deterministic,
    // explainable rule - not a prediction.
    const activeRecently = await this.prisma.exerciseSession.groupBy({
      by: ['patientId'],
      where: {
        patientId: { in: patientIds },
        status: SessionStatus.COMPLETED,
        startedAt: { gte: weekAgo },
      },
    });
    const activeIds = new Set(activeRecently.map((r) => r.patientId));
    const inactiveIds = patientIds.filter((id) => !activeIds.has(id));

    const inactivePatients = await this.prisma.patientProfile.findMany({
      where: { id: { in: inactiveIds } },
      include: { user: { select: { firstName: true, lastName: true } } },
      take: 5,
    });

    return {
      caseload: patientIds.length,
      activePlans,
      activeAssignments,
      sessionsThisWeek,
      averageScore:
        scoreAgg._avg.performanceScore !== null
          ? Math.round(scoreAgg._avg.performanceScore * 10) / 10
          : null,
      recentSessions: recentSessions.map((s) => ({
        sessionId: s.id,
        patientProfileId: s.patientId,
        patientName: `${s.patient.user.firstName} ${s.patient.user.lastName}`,
        exercise: s.exercise.name,
        startedAt: s.startedAt.toISOString(),
        // Without goalType the caseload reads "0/1 reps" for every posture
        // session - describing a completed exercise as a total failure,
        // because a held session records no repetitions by design.
        goalType: s.goalType,
        totalReps: s.totalReps,
        targetTotalReps: s.targetTotalReps,
        heldSec: s.heldSec,
        targetHoldSec: s.targetHoldSec,
        performanceScore: s.performanceScore,
      })),
      patientsNeedingReview: inactivePatients.map((p) => ({
        patientProfileId: p.id,
        name: `${p.user.firstName} ${p.user.lastName}`,
        reason: 'No completed session in the last 7 days',
      })),
    };
  }
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
