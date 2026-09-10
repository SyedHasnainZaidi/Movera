import { LinkStatus, UserRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { AuthUser } from '../decorators/current-user.decorator';
import { AppErrorCode } from '../errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessControlService } from './access-control.service';

/**
 * Ownership authorization.
 *
 * This is the single most security-critical unit in the backend: the
 * superseded Express prototype was missing exactly these checks, which let any
 * therapist read any patient. Every branch is tested.
 */
describe('AccessControlService', () => {
  let service: AccessControlService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;

  const patient = (id: string): AuthUser => ({
    userId: `user-${id}`,
    email: `${id}@example.com`,
    role: UserRole.PATIENT,
    patientProfileId: id,
  });

  const therapist = (id: string): AuthUser => ({
    userId: `user-${id}`,
    email: `${id}@example.com`,
    role: UserRole.THERAPIST,
    therapistProfileId: id,
  });

  beforeEach(async () => {
    findUnique = jest.fn();
    findMany = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessControlService,
        {
          provide: PrismaService,
          useValue: { therapistPatient: { findUnique, findMany } },
        },
      ],
    }).compile();

    service = moduleRef.get(AccessControlService);
  });

  describe('requirePatientProfileId', () => {
    it('returns the profile id for a patient', () => {
      expect(service.requirePatientProfileId(patient('p1'))).toBe('p1');
    });

    it('rejects a therapist', () => {
      expect(() => service.requirePatientProfileId(therapist('t1'))).toThrow(
        expect.objectContaining({ code: AppErrorCode.FORBIDDEN_ROLE }),
      );
    });

    it('rejects a patient whose profile is missing', () => {
      const broken: AuthUser = {
        userId: 'u',
        email: 'e',
        role: UserRole.PATIENT,
      };
      expect(() => service.requirePatientProfileId(broken)).toThrow();
    });
  });

  describe('assertCanAccessPatient - patient callers', () => {
    it('allows a patient to reach their own record', async () => {
      await expect(
        service.assertCanAccessPatient(patient('p1'), 'p1'),
      ).resolves.toBeUndefined();
      // No database lookup is needed for the self case.
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('refuses a patient reaching another patient', async () => {
      await expect(
        service.assertCanAccessPatient(patient('p1'), 'p2'),
      ).rejects.toThrow(
        expect.objectContaining({ code: AppErrorCode.PATIENT_ACCESS_DENIED }),
      );
    });
  });

  describe('assertCanAccessPatient - therapist callers', () => {
    it('allows a therapist with an ACTIVE link', async () => {
      findUnique.mockResolvedValue({ status: LinkStatus.ACTIVE });
      await expect(
        service.assertCanAccessPatient(therapist('t1'), 'p1'),
      ).resolves.toBeUndefined();
    });

    it('refuses a therapist with no link at all', async () => {
      findUnique.mockResolvedValue(null);
      await expect(
        service.assertCanAccessPatient(therapist('t1'), 'p1'),
      ).rejects.toThrow(
        expect.objectContaining({ code: AppErrorCode.THERAPIST_LINK_REQUIRED }),
      );
    });

    it('refuses a therapist whose link has been made INACTIVE', async () => {
      // Unlinking is a soft delete, so the row still exists. Access must stop
      // regardless.
      findUnique.mockResolvedValue({ status: LinkStatus.INACTIVE });
      await expect(
        service.assertCanAccessPatient(therapist('t1'), 'p1'),
      ).rejects.toThrow(
        expect.objectContaining({ code: AppErrorCode.THERAPIST_LINK_REQUIRED }),
      );
    });

    it('queries the link by the composite key, not by patient id alone', async () => {
      findUnique.mockResolvedValue({ status: LinkStatus.ACTIVE });
      await service.assertCanAccessPatient(therapist('t1'), 'p1');

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            therapistId_patientId: { therapistId: 't1', patientId: 'p1' },
          },
        }),
      );
    });
  });

  describe('assertCanManagePatient', () => {
    it('returns the therapist profile id when linked', async () => {
      findUnique.mockResolvedValue({ status: LinkStatus.ACTIVE });
      await expect(
        service.assertCanManagePatient(therapist('t1'), 'p1'),
      ).resolves.toBe('t1');
    });

    it('refuses a PATIENT outright - writes are therapist-only', async () => {
      await expect(
        service.assertCanManagePatient(patient('p1'), 'p1'),
      ).rejects.toThrow(
        expect.objectContaining({ code: AppErrorCode.FORBIDDEN_ROLE }),
      );
    });

    it('refuses an unlinked therapist', async () => {
      findUnique.mockResolvedValue(null);
      await expect(
        service.assertCanManagePatient(therapist('t1'), 'p9'),
      ).rejects.toThrow(
        expect.objectContaining({ code: AppErrorCode.THERAPIST_LINK_REQUIRED }),
      );
    });
  });

  describe('managedPatientIds', () => {
    it('returns only ACTIVE links', async () => {
      findMany.mockResolvedValue([{ patientId: 'p1' }, { patientId: 'p2' }]);
      await expect(service.managedPatientIds('t1')).resolves.toEqual([
        'p1',
        'p2',
      ]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { therapistId: 't1', status: LinkStatus.ACTIVE },
        }),
      );
    });

    it('returns an empty list for a therapist with no patients', async () => {
      findMany.mockResolvedValue([]);
      await expect(service.managedPatientIds('t1')).resolves.toEqual([]);
    });
  });
});
