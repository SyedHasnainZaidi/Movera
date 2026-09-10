import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

/** Shape attached to `request.user` by JwtStrategy. */
export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  /** PatientProfile.id when role is PATIENT, otherwise undefined. */
  patientProfileId?: string;
  /** TherapistProfile.id when role is THERAPIST, otherwise undefined. */
  therapistProfileId?: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
