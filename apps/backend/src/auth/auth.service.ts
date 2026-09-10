import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, Prisma, UserRole } from '@prisma/client';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { AppConfigService } from '../config/app-config.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthResponseDto,
  AuthUserDto,
  ChangePasswordDto,
  LoginDto,
  PUBLIC_ROLES,
  RegisterDto,
  RegistrationResultDto,
} from './dto/auth.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface IssuedSession {
  response: AuthResponseDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Returned by every endpoint that acts on an email address supplied by an
 * anonymous caller (forgot password, resend verification).
 *
 * The wording is identical whether or not the address exists. Anything else
 * turns these endpoints into an account-enumeration oracle - "no such user"
 * tells an attacker exactly which addresses are registered.
 */
const NEUTRAL_EMAIL_RESPONSE = {
  message:
    'If an account exists for that email address, we have sent it a message. ' +
    'Please check your inbox, including the spam folder.',
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly email: EmailService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates the User and its role profile in one transaction: a User without a
   * profile would be a half-registered account that breaks every domain query.
   *
   * No session is issued. The account starts unverified and `login` refuses
   * unverified accounts, so handing back an access token here would let a
   * caller straight past the rule that was just introduced.
   */
  async register(dto: RegisterDto): Promise<RegistrationResultDto> {
    // Defence in depth. The DTO already restricts this, but registration is the
    // one endpoint where a role-escalation bug is unrecoverable.
    if (!(PUBLIC_ROLES as readonly string[]).includes(dto.role)) {
      throw AppError.badRequest(
        AppErrorCode.INVALID_ROLE,
        'Role must be PATIENT or THERAPIST.',
      );
    }

    const email = dto.email.trim().toLowerCase();

    // Email is unique across BOTH roles, so the same address cannot hold a
    // patient account and a therapist account. The database constraint is the
    // real guarantee; this check exists to return a helpful message instead of
    // a raw constraint violation.
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        AppErrorCode.EMAIL_ALREADY_REGISTERED,
        'This email is already registered. Please use a different email address.',
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const verification = this.tokens.createVerificationToken();

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: dto.role,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          timezone: dto.timezone?.trim() || 'UTC',
          emailVerified: false,
          verificationTokenHash: verification.hash,
          verificationTokenExpiry: verification.expiresAt,
        },
      });

      if (dto.role === UserRole.PATIENT) {
        await tx.patientProfile.create({ data: { userId: created.id } });
      } else {
        await tx.therapistProfile.create({ data: { userId: created.id } });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        select: userSelect,
      });
    });

    // Outside the transaction on purpose: a slow or unreachable mail server
    // must not hold a database transaction open, and must not roll back an
    // account that was successfully created.
    const sent = await this.email.sendVerification({
      to: user.email,
      firstName: user.firstName,
      token: verification.raw,
    });

    this.logger.log(
      `Registered ${user.role} ${user.id} (verification email sent: ${sent})`,
    );

    return {
      email: user.email,
      emailVerificationRequired: true,
      verificationEmailSent: sent,
      message: sent
        ? 'Account created. Check your email for a verification link, then sign in.'
        : 'Account created, but the verification email could not be sent. ' +
          'Use "resend verification email" to try again.',
    };
  }

  /**
   * Confirms an email address from the emailed token.
   *
   * Idempotent in the way that matters: a token is consumed on first use, so a
   * second click returns a clear "link is no longer valid" rather than a
   * server error. The user is already verified at that point and can sign in.
   */
  async verifyEmail(rawToken: string): Promise<{ email: string; message: string }> {
    const tokenHash = this.tokens.hashEmailToken(rawToken.trim());

    const user = await this.prisma.user.findUnique({
      where: { verificationTokenHash: tokenHash },
      select: { id: true, email: true, verificationTokenExpiry: true },
    });

    if (!user) {
      throw AppError.badRequest(
        AppErrorCode.INVALID_VERIFICATION_TOKEN,
        'This verification link is invalid or has already been used. ' +
          'Request a new one from the sign-in page.',
      );
    }

    if (
      !user.verificationTokenExpiry ||
      user.verificationTokenExpiry.getTime() <= Date.now()
    ) {
      throw AppError.badRequest(
        AppErrorCode.INVALID_VERIFICATION_TOKEN,
        'This verification link has expired. Request a new one from the sign-in page.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        // Consumed: the link cannot be replayed.
        verificationTokenHash: null,
        verificationTokenExpiry: null,
      },
    });

    this.logger.log(`Email verified for user ${user.id}`);
    return {
      email: user.email,
      message: 'Your email is verified. You can now sign in.',
    };
  }

  /** Issues a fresh verification link. Never reveals whether the account exists. */
  async resendVerification(rawEmail: string): Promise<{ message: string }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, emailVerified: true },
    });

    if (user && !user.emailVerified) {
      const verification = this.tokens.createVerificationToken();
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          verificationTokenHash: verification.hash,
          verificationTokenExpiry: verification.expiresAt,
        },
      });
      await this.email.sendVerification({
        to: user.email,
        firstName: user.firstName,
        token: verification.raw,
      });
    }

    return NEUTRAL_EMAIL_RESPONSE;
  }

  /**
   * Starts password recovery.
   *
   * Always reports success. An "unknown email" response here would let anyone
   * test whether a given address has an account on a health platform, which is
   * itself sensitive information.
   */
  async forgotPassword(rawEmail: string): Promise<{ message: string }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, status: true },
    });

    if (user && user.status === AccountStatus.ACTIVE) {
      const reset = this.tokens.createPasswordResetToken();
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordTokenHash: reset.hash,
          resetPasswordTokenExpiry: reset.expiresAt,
        },
      });
      await this.email.sendPasswordReset({
        to: user.email,
        firstName: user.firstName,
        token: reset.raw,
      });
      this.logger.log(`Password reset requested for user ${user.id}`);
    }

    return NEUTRAL_EMAIL_RESPONSE;
  }

  /**
   * Completes password recovery.
   *
   * Three things happen together and must not come apart: the password is
   * replaced, the reset token is destroyed so the link is single-use, and every
   * existing session is revoked. That last one matters most - if the reset was
   * triggered because the account was compromised, leaving the attacker's
   * refresh token alive would defeat the entire exercise.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = this.tokens.hashEmailToken(rawToken.trim());

    const user = await this.prisma.user.findUnique({
      where: { resetPasswordTokenHash: tokenHash },
      select: { id: true, resetPasswordTokenExpiry: true },
    });

    if (
      !user ||
      !user.resetPasswordTokenExpiry ||
      user.resetPasswordTokenExpiry.getTime() <= Date.now()
    ) {
      throw AppError.badRequest(
        AppErrorCode.INVALID_RESET_TOKEN,
        'This password reset link is invalid or has expired. Please request a new one.',
      );
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          resetPasswordTokenHash: null,
          resetPasswordTokenExpiry: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log(`Password reset completed for user ${user.id}`);
    return {
      message: 'Your password has been changed. Please sign in with your new password.',
    };
  }

  async login(dto: LoginDto, userAgent?: string): Promise<IssuedSession> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        ...userSelect,
        passwordHash: true,
        status: true,
        emailVerified: true,
      },
    });

    // Hash a dummy value when the user does not exist so that a missing account
    // and a wrong password take comparable time - otherwise response timing
    // enumerates registered email addresses.
    if (!user) {
      await this.passwords.hash(dto.password);
      throw AppError.unauthorized(
        AppErrorCode.INVALID_CREDENTIALS,
        'Email or password is incorrect.',
      );
    }

    const ok = await this.passwords.verify(dto.password, user.passwordHash);
    if (!ok) {
      throw AppError.unauthorized(
        AppErrorCode.INVALID_CREDENTIALS,
        'Email or password is incorrect.',
      );
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw AppError.unauthorized(
        AppErrorCode.ACCOUNT_NOT_ACTIVE,
        'This account is not active. Contact your therapist or administrator.',
      );
    }

    // Checked AFTER the password, deliberately. Reporting "email not verified"
    // to someone who supplied the wrong password would confirm the account
    // exists to anyone guessing addresses.
    if (!user.emailVerified) {
      throw AppError.unauthorized(
        AppErrorCode.EMAIL_NOT_VERIFIED,
        'Please verify your email before logging in.',
      );
    }

    return this.issueSession(user, userAgent);
  }

  /**
   * Rotating refresh.
   *
   * Every use mints a new token and marks the old one replaced. Presenting a
   * token that has already been replaced means the token leaked and is being
   * replayed, so the entire chain for that user is revoked - the legitimate
   * user is logged out everywhere, which is the correct response to theft.
   */
  async refresh(rawToken: string, userAgent?: string): Promise<IssuedSession> {
    const tokenHash = this.tokens.hashRefreshToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
      },
    });

    if (!stored) {
      throw AppError.unauthorized(
        AppErrorCode.INVALID_REFRESH_TOKEN,
        'Your session has expired. Please sign in again.',
      );
    }

    if (stored.replacedById || stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; all sessions revoked`,
      );
      throw AppError.unauthorized(
        AppErrorCode.REFRESH_TOKEN_REUSED,
        'Your session was ended for security reasons. Please sign in again.',
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized(
        AppErrorCode.INVALID_REFRESH_TOKEN,
        'Your session has expired. Please sign in again.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { ...userSelect, status: true },
    });
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw AppError.unauthorized(
        AppErrorCode.ACCOUNT_NOT_ACTIVE,
        'This account is not active.',
      );
    }

    const next = this.tokens.createRefreshToken();

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: next.hash,
          expiresAt: next.expiresAt,
          userAgent: userAgent?.slice(0, 255),
        },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { replacedById: created.id, revokedAt: new Date() },
      });
    });

    return {
      response: await this.buildResponse(user),
      refreshToken: next.raw,
      refreshExpiresAt: next.expiresAt,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const tokenHash = this.tokens.hashRefreshToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw AppError.notFound(AppErrorCode.NOT_FOUND, 'User not found.');
    }

    const ok = await this.passwords.verify(dto.currentPassword, user.passwordHash);
    if (!ok) {
      throw AppError.badRequest(
        AppErrorCode.CURRENT_PASSWORD_INCORRECT,
        'Your current password is incorrect.',
      );
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);

    // Changing a password invalidates every other session.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async me(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) {
      throw AppError.notFound(AppErrorCode.NOT_FOUND, 'User not found.');
    }
    return toAuthUserDto(user);
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(
    user: UserWithProfiles,
    userAgent?: string,
  ): Promise<IssuedSession> {
    const refresh = this.tokens.createRefreshToken();

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        userAgent: userAgent?.slice(0, 255),
      },
    });

    return {
      response: await this.buildResponse(user),
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async buildResponse(
    user: UserWithProfiles,
  ): Promise<AuthResponseDto> {
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      patientProfileId: user.patientProfile?.id,
      therapistProfileId: user.therapistProfile?.id,
    });

    return {
      accessToken,
      expiresIn: this.tokens.accessExpiresInSeconds,
      user: toAuthUserDto(user),
    };
  }
}

/**
 * The ONLY projection used to read a user for an auth response.
 * `passwordHash` is absent by construction, so it cannot leak through a
 * forgotten `select`.
 */
const userSelect = {
  id: true,
  email: true,
  role: true,
  firstName: true,
  lastName: true,
  timezone: true,
  patientProfile: { select: { id: true } },
  therapistProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

type UserWithProfiles = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toAuthUserDto(user: UserWithProfiles): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    timezone: user.timezone,
    patientProfileId: user.patientProfile?.id,
    therapistProfileId: user.therapistProfile?.id,
  };
}
