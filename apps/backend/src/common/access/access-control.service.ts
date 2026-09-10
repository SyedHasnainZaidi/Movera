import { Injectable } from '@nestjs/common';
import { LinkStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../errors/app-error';

/**
 * Central ownership authorization.
 *
 * Deliberately an injectable SERVICE rather than a clever guard/decorator:
 * every check needs the resource loaded from the database anyway, and an
 * explicit `await this.access.assertCanAccessPatient(user, patientId)` at the
 * top of a service method is trivially unit-testable and impossible to
 * misconfigure silently. The superseded Express prototype had exactly this
 * check missing on three therapist routes, which let any therapist read any
 * patient - see legacy/README.md.
 *
 * The rule enforced here:
 *   PATIENT   -> may touch only rows whose patientProfileId is their own.
 *   THERAPIST -> may touch a patient only if an ACTIVE TherapistPatient link
 *                exists between them. A patientId in a URL is never trusted.
 */
@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's PatientProfile.id, or a 403 if they are not a patient. */
  requirePatientProfileId(user: AuthUser): string {
    if (user.role !== UserRole.PATIENT || !user.patientProfileId) {
      throw AppError.forbidden(
        AppErrorCode.FORBIDDEN_ROLE,
        'This action is only available to patients.',
      );
    }
    return user.patientProfileId;
  }

  /** The caller's TherapistProfile.id, or a 403 if they are not a therapist. */
  requireTherapistProfileId(user: AuthUser): string {
    if (user.role !== UserRole.THERAPIST || !user.therapistProfileId) {
      throw AppError.forbidden(
        AppErrorCode.FORBIDDEN_ROLE,
        'This action is only available to therapists.',
      );
    }
    return user.therapistProfileId;
  }

  /**
   * True if `therapistProfileId` currently manages `patientProfileId`.
   * A link that has been set INACTIVE does not grant access.
   */
  async hasActiveLink(
    therapistProfileId: string,
    patientProfileId: string,
  ): Promise<boolean> {
    const link = await this.prisma.therapistPatient.findUnique({
      where: {
        therapistId_patientId: {
          therapistId: therapistProfileId,
          patientId: patientProfileId,
        },
      },
      select: { status: true },
    });
    return link?.status === LinkStatus.ACTIVE;
  }

  /**
   * The single gate used by every endpoint that reads or writes patient-owned
   * data. Patients pass for themselves; therapists pass only through a link.
   */
  async assertCanAccessPatient(
    user: AuthUser,
    patientProfileId: string,
  ): Promise<void> {
    if (user.role === UserRole.PATIENT) {
      if (user.patientProfileId !== patientProfileId) {
        // 403 rather than 404: the caller is authenticated and the resource
        // exists; hiding that fact buys nothing here because IDs are CUIDs and
        // therefore unguessable.
        throw AppError.forbidden(
          AppErrorCode.PATIENT_ACCESS_DENIED,
          'You do not have access to this patient record.',
        );
      }
      return;
    }

    if (user.role === UserRole.THERAPIST) {
      const therapistProfileId = this.requireTherapistProfileId(user);
      if (!(await this.hasActiveLink(therapistProfileId, patientProfileId))) {
        throw AppError.forbidden(
          AppErrorCode.THERAPIST_LINK_REQUIRED,
          'You are not linked to this patient.',
        );
      }
      return;
    }

    throw AppError.forbidden(
      AppErrorCode.PATIENT_ACCESS_DENIED,
      'You do not have access to this patient record.',
    );
  }

  /** Write operations are therapist-only AND require the link. */
  async assertCanManagePatient(
    user: AuthUser,
    patientProfileId: string,
  ): Promise<string> {
    const therapistProfileId = this.requireTherapistProfileId(user);
    if (!(await this.hasActiveLink(therapistProfileId, patientProfileId))) {
      throw AppError.forbidden(
        AppErrorCode.THERAPIST_LINK_REQUIRED,
        'You are not linked to this patient.',
      );
    }
    return therapistProfileId;
  }

  /** Patient profile ids this therapist may see - for list endpoints. */
  async managedPatientIds(therapistProfileId: string): Promise<string[]> {
    const links = await this.prisma.therapistPatient.findMany({
      where: { therapistId: therapistProfileId, status: LinkStatus.ACTIVE },
      select: { patientId: true },
    });
    return links.map((l) => l.patientId);
  }
}
