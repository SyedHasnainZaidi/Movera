import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSmtpConfigured, type Env } from './env.validation';

/**
 * Typed accessor over the validated environment.
 *
 * Everything reachable here has already passed `envSchema`, so no call site
 * needs `?? 'default'` handling and no secret can be undefined at runtime.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }
  get port(): number {
    return this.get('PORT');
  }
  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  /** Browser origins permitted by CORS. Never `*` in this application. */
  get corsOrigins(): string[] {
    return this.get('FRONTEND_URL')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get accessSecret(): string {
    return this.get('JWT_ACCESS_SECRET');
  }
  get accessExpiresIn(): string {
    return this.get('JWT_ACCESS_EXPIRES_IN');
  }
  get refreshSecret(): string {
    return this.get('JWT_REFRESH_SECRET');
  }
  get refreshExpiresIn(): string {
    return this.get('JWT_REFRESH_EXPIRES_IN');
  }

  get poseTicketSecret(): string {
    return this.get('POSE_TICKET_SECRET');
  }
  get poseTicketExpiresIn(): string {
    return this.get('POSE_TICKET_EXPIRES_IN');
  }
  get poseServiceToken(): string {
    return this.get('POSE_SERVICE_TOKEN');
  }
  get poseServiceUrl(): string {
    return this.get('POSE_SERVICE_URL');
  }

  get inviteCodeTtlMinutes(): number {
    return this.get('INVITE_CODE_TTL_MINUTES');
  }
  get createdSessionTtlMinutes(): number {
    return this.get('CREATED_SESSION_TTL_MINUTES');
  }
  get activeSessionTtlMinutes(): number {
    return this.get('ACTIVE_SESSION_TTL_MINUTES');
  }

  get throttleTtlSeconds(): number {
    return this.get('THROTTLE_TTL_SECONDS');
  }
  get throttleLimit(): number {
    return this.get('THROTTLE_LIMIT');
  }
  /** See TRUST_PROXY in env.validation.ts - off unless a proxy sets the header. */
  get trustProxy(): boolean {
    return this.get('TRUST_PROXY');
  }

  get cookieSecure(): boolean {
    return this.get('COOKIE_SECURE');
  }
  get refreshCookiePath(): string {
    return this.get('REFRESH_COOKIE_PATH');
  }

  /** Milliseconds represented by a duration string such as "15m" or "7d". */
  get refreshExpiresMs(): number {
    return durationToMs(this.refreshExpiresIn);
  }

  // --- Branding -------------------------------------------------------------

  get appName(): string {
    return this.get('APP_NAME');
  }

  /**
   * Base URL for links inside emails.
   *
   * Falls back to the first CORS origin, which is the frontend in every
   * standard setup - so the common case needs no extra configuration and
   * cannot drift out of sync with FRONTEND_URL.
   */
  get publicUrl(): string {
    const explicit = this.get('APP_PUBLIC_URL');
    if (explicit) return explicit.replace(/\/+$/, '');
    return (this.corsOrigins[0] ?? 'http://localhost:5173').replace(/\/+$/, '');
  }

  // --- Email ----------------------------------------------------------------

  get smtpConfigured(): boolean {
    return isSmtpConfigured({
      SMTP_HOST: this.get('SMTP_HOST'),
      SMTP_USER: this.get('SMTP_USER'),
      SMTP_PASSWORD: this.get('SMTP_PASSWORD'),
    });
  }

  get smtp(): {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  } | null {
    if (!this.smtpConfigured) return null;
    const user = this.get('SMTP_USER') as string;
    return {
      host: this.get('SMTP_HOST') as string,
      port: this.get('SMTP_PORT'),
      user,
      password: this.get('SMTP_PASSWORD') as string,
      // A bare address is wrapped so the recipient sees the product name.
      from: this.get('SMTP_FROM') ?? `${this.appName} <${user}>`,
    };
  }

  get emailVerificationTtlHours(): number {
    return this.get('EMAIL_VERIFICATION_TTL_HOURS');
  }
  get passwordResetTtlMinutes(): number {
    return this.get('PASSWORD_RESET_TTL_MINUTES');
  }
}

export function durationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error(`Unsupported duration string: "${duration}"`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}
