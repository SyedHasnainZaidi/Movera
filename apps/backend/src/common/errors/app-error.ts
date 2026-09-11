import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes.
 *
 * The frontend switches on `code`, never on `message`, so wording can change
 * without breaking the client. Every code that reaches a user is listed here -
 * there are no ad-hoc strings thrown from services.
 */
export enum AppErrorCode {
  // --- auth ---
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED',
  INVALID_REFRESH_TOKEN = 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_REUSED = 'REFRESH_TOKEN_REUSED',
  ACCOUNT_NOT_ACTIVE = 'ACCOUNT_NOT_ACTIVE',
  INVALID_ROLE = 'INVALID_ROLE',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  CURRENT_PASSWORD_INCORRECT = 'CURRENT_PASSWORD_INCORRECT',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_VERIFIED = 'EMAIL_ALREADY_VERIFIED',
  INVALID_VERIFICATION_TOKEN = 'INVALID_VERIFICATION_TOKEN',
  INVALID_RESET_TOKEN = 'INVALID_RESET_TOKEN',

  // --- authorization ---
  FORBIDDEN_ROLE = 'FORBIDDEN_ROLE',
  PATIENT_ACCESS_DENIED = 'PATIENT_ACCESS_DENIED',
  THERAPIST_LINK_REQUIRED = 'THERAPIST_LINK_REQUIRED',
  RESOURCE_NOT_OWNED = 'RESOURCE_NOT_OWNED',
  INTERNAL_AUTH_FAILED = 'INTERNAL_AUTH_FAILED',

  // --- profiles / linking ---
  PROFILE_NOT_FOUND = 'PROFILE_NOT_FOUND',
  INVITE_INVALID = 'INVITE_INVALID',
  INVITE_EXPIRED = 'INVITE_EXPIRED',
  INVITE_ALREADY_USED = 'INVITE_ALREADY_USED',
  ALREADY_LINKED = 'ALREADY_LINKED',
  LINK_NOT_FOUND = 'LINK_NOT_FOUND',

  // --- prescription ---
  EXERCISE_NOT_FOUND = 'EXERCISE_NOT_FOUND',
  EXERCISE_INACTIVE = 'EXERCISE_INACTIVE',
  RULE_CONFIG_MISSING = 'RULE_CONFIG_MISSING',
  PLAN_NOT_FOUND = 'PLAN_NOT_FOUND',
  PLAN_NOT_ACTIVE = 'PLAN_NOT_ACTIVE',
  ACTIVE_PLAN_EXISTS = 'ACTIVE_PLAN_EXISTS',
  ASSIGNMENT_NOT_FOUND = 'ASSIGNMENT_NOT_FOUND',
  ASSIGNMENT_NOT_ACTIVE = 'ASSIGNMENT_NOT_ACTIVE',

  // --- sessions ---
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_ALREADY_LIVE = 'SESSION_ALREADY_LIVE',
  SESSION_INVALID_STATE = 'SESSION_INVALID_STATE',
  SESSION_NOT_ACTIVE = 'SESSION_NOT_ACTIVE',
  SESSION_ALREADY_FINALIZED = 'SESSION_ALREADY_FINALIZED',
  REP_OUT_OF_RANGE = 'REP_OUT_OF_RANGE',
  REP_UNKNOWN_ERROR_CODE = 'REP_UNKNOWN_ERROR_CODE',
  REPORT_NOT_FOUND = 'REPORT_NOT_FOUND',

  // --- generic ---
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  POSE_SERVICE_UNAVAILABLE = 'POSE_SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface AppErrorBody {
  statusCode: number;
  code: AppErrorCode;
  message: string;
  correlationId?: string;
  /** Field-level detail, populated only by validation failures. */
  details?: unknown;
}

/**
 * The only exception type services should throw. Carries a stable code
 * alongside the HTTP status so the filter never has to guess.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static unauthorized(code: AppErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(code: AppErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.FORBIDDEN);
  }

  static notFound(code: AppErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.NOT_FOUND);
  }

  /**
   * `details` matters here more than on most errors: a conflict is usually
   * caused by a specific OTHER row, and the client can only offer a way out of
   * it - resume that one, cancel it - if it is told which one.
   */
  static conflict(
    code: AppErrorCode,
    message: string,
    details?: unknown,
  ): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }

  static badRequest(
    code: AppErrorCode,
    message: string,
    details?: unknown,
  ): AppError {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }
}
