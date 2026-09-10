import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Password policy - defined once and applied to every endpoint that accepts a
 * new password (registration, change, reset).
 *
 * "Special character" is defined as anything that is not a letter or a digit,
 * rather than an allow-list of punctuation. An allow-list silently rejects
 * perfectly good passwords containing characters the author did not think of,
 * which teaches users to pick weaker ones.
 *
 * The frontend mirrors these rules for immediate feedback; this is the copy
 * that actually enforces them.
 */
export const PASSWORD_MIN_LENGTH = 7;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_SPECIAL_CHARACTER = /[^A-Za-z0-9]/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 7 characters and include at least one special character.';

/**
 * Roles a client may request at registration.
 *
 * ADMIN is intentionally NOT in this list. The superseded Express prototype
 * passed `role` straight from the body into User.create() with an enum that
 * accepted 'admin', which let anyone self-promote. Here the allowed set is a
 * literal union validated by class-validator AND re-checked in AuthService.
 */
export const PUBLIC_ROLES = [UserRole.PATIENT, UserRole.THERAPIST] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export class RegisterDto {
  @ApiProperty({ example: 'patient1@example.com' })
  @IsEmail({}, { message: 'A valid email address is required.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'DevPassword123!', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_SPECIAL_CHARACTER, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Raza' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({ enum: PUBLIC_ROLES, example: UserRole.PATIENT })
  @IsIn(PUBLIC_ROLES as unknown as string[], {
    message: 'Role must be PATIENT or THERAPIST.',
  })
  role!: PublicRole;

  @ApiPropertyOptional({ example: 'Asia/Karachi', default: 'UTC' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'patient1@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'DevPassword123!' })
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_SPECIAL_CHARACTER, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the verification link.' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'patient1@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'patient1@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the password reset link.' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_SPECIAL_CHARACTER, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;
}

/**
 * Registration no longer returns a session.
 *
 * The account exists but cannot sign in until the emailed link is followed, so
 * returning an access token here would contradict the rule that login enforces.
 */
export class RegistrationResultDto {
  @ApiProperty({ example: 'patient1@example.com' })
  email!: string;

  @ApiProperty({ example: true })
  emailVerificationRequired!: boolean;

  @ApiProperty({
    description:
      'False when the message could not be handed to the mail server. The ' +
      'account still exists; the user should use "resend verification".',
  })
  verificationEmailSent!: boolean;

  @ApiProperty()
  message!: string;
}

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() timezone!: string;
  @ApiPropertyOptional() patientProfileId?: string;
  @ApiPropertyOptional() therapistProfileId?: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived JWT. Hold in memory, not localStorage.' })
  accessToken!: string;

  @ApiProperty({ description: 'Seconds until the access token expires.' })
  expiresIn!: number;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}
