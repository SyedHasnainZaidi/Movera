import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppError, AppErrorCode } from '../errors/app-error';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser }>();

    if (!user) {
      throw AppError.unauthorized(
        AppErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }

    if (!required.includes(user.role)) {
      throw AppError.forbidden(
        AppErrorCode.FORBIDDEN_ROLE,
        `This action requires the ${required.join(' or ')} role.`,
      );
    }

    return true;
  }
}
