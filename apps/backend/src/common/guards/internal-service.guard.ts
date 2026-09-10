import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { IS_INTERNAL_KEY } from '../decorators/internal.decorator';
import { AppError, AppErrorCode } from '../errors/app-error';

/**
 * Protects the pose-service -> backend channel.
 *
 * These endpoints are how repetitions become permanent, so they are the most
 * security-sensitive surface in the system after authentication itself. The
 * comparison is constant-time: a naive `===` on a secret leaks its prefix
 * through timing, and this token guards write access to clinical records.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isInternal = this.reflector.getAllAndOverride<boolean>(
      IS_INTERNAL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isInternal) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.headers['x-internal-token'];

    if (typeof presented !== 'string' || presented.length === 0) {
      throw AppError.unauthorized(
        AppErrorCode.INTERNAL_AUTH_FAILED,
        'Internal service authentication required.',
      );
    }

    if (!constantTimeEquals(presented, this.config.poseServiceToken)) {
      throw AppError.unauthorized(
        AppErrorCode.INTERNAL_AUTH_FAILED,
        'Internal service authentication failed.',
      );
    }

    return true;
  }
}

/**
 * Length-safe constant-time comparison. `timingSafeEqual` throws on
 * length mismatch, which would itself be a timing oracle, so both sides are
 * hashed to a fixed width first via padding to the longer length.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const width = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(width);
  const paddedB = Buffer.alloc(width);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  // Still compare declared lengths so padding cannot create a false match.
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}
