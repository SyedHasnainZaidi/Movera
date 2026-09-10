import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError, AppErrorCode, type AppErrorBody } from '../errors/app-error';

/**
 * Single exit point for every error leaving the API.
 *
 * Guarantees, in order of importance:
 *   1. A stack trace is NEVER sent to a client, in any environment.
 *   2. Every response carries a stable `code` and a `correlationId`.
 *   3. Prisma's internal error shapes are translated, so a unique-constraint
 *      violation never leaks a table or column name to the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request as Request & { correlationId?: string }).correlationId;

    const body = this.toBody(exception, correlationId);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code} [${correlationId ?? '-'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code} [${correlationId ?? '-'}]`,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, correlationId?: string): AppErrorBody {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        correlationId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      // ValidationPipe produces { message: string[], error, statusCode }.
      if (
        typeof res === 'object' &&
        res !== null &&
        Array.isArray((res as { message?: unknown }).message)
      ) {
        return {
          statusCode: status,
          code: AppErrorCode.VALIDATION_FAILED,
          message: 'Request validation failed.',
          details: (res as { message: string[] }).message,
          correlationId,
        };
      }

      const code = this.codeForStatus(status);

      // ThrottlerException's own message is "ThrottlerException: Too Many
      // Requests", which leaks an internal class name and tells the user
      // nothing useful. Replace it with something actionable.
      if (code === AppErrorCode.RATE_LIMITED) {
        return {
          statusCode: status,
          code,
          message: 'Too many attempts. Please wait a moment and try again.',
          correlationId,
        };
      }

      return {
        statusCode: status,
        code,
        message:
          typeof res === 'string'
            ? res
            : ((res as { message?: string }).message ?? exception.message),
        correlationId,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception, correlationId);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: AppErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
      correlationId,
    };
  }

  private fromPrisma(
    error: Prisma.PrismaClientKnownRequestError,
    correlationId?: string,
  ): AppErrorBody {
    switch (error.code) {
      case 'P2002': // unique constraint
        return {
          statusCode: HttpStatus.CONFLICT,
          code: AppErrorCode.VALIDATION_FAILED,
          message: 'That record already exists.',
          correlationId,
        };
      case 'P2025': // record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: AppErrorCode.NOT_FOUND,
          message: 'The requested resource was not found.',
          correlationId,
        };
      case 'P2003': // FK constraint
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: AppErrorCode.VALIDATION_FAILED,
          message: 'A referenced record does not exist.',
          correlationId,
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: AppErrorCode.INTERNAL_ERROR,
          message: 'A database error occurred.',
          correlationId,
        };
    }
  }

  private codeForStatus(status: number): AppErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return AppErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return AppErrorCode.FORBIDDEN_ROLE;
      case HttpStatus.NOT_FOUND:
        return AppErrorCode.NOT_FOUND;
      case HttpStatus.TOO_MANY_REQUESTS:
        return AppErrorCode.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
        return AppErrorCode.VALIDATION_FAILED;
      default:
        return AppErrorCode.INTERNAL_ERROR;
    }
  }
}
