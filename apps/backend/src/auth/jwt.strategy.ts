import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenClaims } from './token.service';

/**
 * Resolves a bearer token into the AuthUser attached to `request.user`.
 *
 * The database is re-checked on every request rather than trusting the token
 * payload alone. That costs one indexed lookup but means deactivating an
 * account takes effect immediately instead of whenever the access token
 * happens to expire.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
    });
  }

  async validate(payload: AccessTokenClaims): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        patientProfile: { select: { id: true } },
        therapistProfile: { select: { id: true } },
      },
    });

    if (!user) {
      throw AppError.unauthorized(
        AppErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw AppError.unauthorized(
        AppErrorCode.ACCOUNT_NOT_ACTIVE,
        'This account is not active.',
      );
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      patientProfileId: user.patientProfile?.id,
      therapistProfileId: user.therapistProfile?.id,
    };
  }
}
