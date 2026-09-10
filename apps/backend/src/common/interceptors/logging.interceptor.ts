import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * One structured line per request.
 *
 * Never logs bodies, headers or query strings: those carry passwords, refresh
 * tokens and pose tickets. Method + path + status + duration is enough to
 * debug, and safe to keep.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const started = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse<{ statusCode: number }>();
        this.logger.log(
          `${req.method} ${req.route?.path ?? req.url} ${res.statusCode} ${Date.now() - started}ms [${req.correlationId ?? '-'}]`,
        );
      }),
    );
  }
}
