import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppConfigService, durationToMs } from '../config/app-config.service';

/**
 * `jsonwebtoken` types `expiresIn` as a template-literal union rather than a
 * plain string. Our durations are already validated by envSchema's
 * /^\d+[smhd]$/ regex, so this alias re-states that guarantee for the compiler
 * instead of scattering `as any` at the call sites.
 */
type JwtDuration = `${number}${'s' | 'm' | 'h' | 'd'}`;

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  patientProfileId?: string;
  therapistProfileId?: string;
}

/**
 * Claims inside the pose ticket presented to the FastAPI pose service.
 *
 * `scope` is checked by the pose service so an application access token can
 * never be replayed as a pose ticket, and a pose ticket can never authenticate
 * against this API. They are also signed with different secrets.
 */
export interface PoseTicketClaims {
  sub: string;
  sessionId: string;
  patientProfileId: string;
  scope: 'pose-session';
  jti: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessExpiresIn as JwtDuration,
    });
  }

  get accessExpiresInSeconds(): number {
    return Math.floor(durationToMs(this.config.accessExpiresIn) / 1000);
  }

  /**
   * Refresh tokens are opaque random bytes, not JWTs.
   *
   * A JWT refresh token is self-validating, which means a stolen one stays
   * valid until expiry even after logout. An opaque token must be looked up in
   * `refresh_tokens`, so revocation is immediate and reuse is detectable.
   * Only the SHA-256 hash is stored - a database leak yields nothing usable.
   */
  createRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(48).toString('base64url');
    return {
      raw,
      hash: hashToken(raw),
      expiresAt: new Date(Date.now() + this.config.refreshExpiresMs),
    };
  }

  hashRefreshToken(raw: string): string {
    return hashToken(raw);
  }

  /**
   * Email verification token.
   *
   * Same shape as a refresh token and for the same reason: it travels in a URL
   * that ends up in mail logs and browser history, so only its SHA-256 hash is
   * stored. Presenting the hash back does not authenticate anything - the
   * lookup is by hash, so a leaked database row cannot be replayed as a link.
   */
  createVerificationToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(32).toString('base64url');
    return {
      raw,
      hash: hashToken(raw),
      expiresAt: new Date(
        Date.now() + this.config.emailVerificationTtlHours * 3_600_000,
      ),
    };
  }

  /**
   * Password reset token.
   *
   * Deliberately shorter-lived than verification: this one can change a
   * credential, so its window of usefulness is measured in minutes.
   */
  createPasswordResetToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(32).toString('base64url');
    return {
      raw,
      hash: hashToken(raw),
      expiresAt: new Date(
        Date.now() + this.config.passwordResetTtlMinutes * 60_000,
      ),
    };
  }

  hashEmailToken(raw: string): string {
    return hashToken(raw);
  }

  async signPoseTicket(input: {
    userId: string;
    sessionId: string;
    patientProfileId: string;
  }): Promise<{ ticket: string; expiresIn: number }> {
    const claims: PoseTicketClaims = {
      sub: input.userId,
      sessionId: input.sessionId,
      patientProfileId: input.patientProfileId,
      scope: 'pose-session',
      jti: randomUUID(),
    };

    const ticket = await this.jwt.signAsync(claims, {
      secret: this.config.poseTicketSecret,
      expiresIn: this.config.poseTicketExpiresIn as JwtDuration,
    });

    return {
      ticket,
      expiresIn: Math.floor(
        durationToMs(this.config.poseTicketExpiresIn) / 1000,
      ),
    };
  }
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
