import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_INTERNAL_KEY } from '../decorators/internal.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError, AppErrorCode } from '../errors/app-error';

/**
 * Applied globally. Routes opt out with @Public() (login, register, health) or
 * @Internal() (pose-service channel, guarded by InternalServiceGuard instead).
 *
 * Default-deny is the point: adding a new controller without thinking about
 * auth yields a locked endpoint, not an open one.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const internal = this.reflector.getAllAndOverride<boolean>(IS_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || internal) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw AppError.unauthorized(
        AppErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    return user;
  }
}
