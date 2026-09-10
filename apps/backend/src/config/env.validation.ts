import { z } from 'zod';

/**
 * Environment contract for the backend.
 *
 * There are deliberately NO fallback values for any secret. A missing
 * JWT_ACCESS_SECRET must crash the process at boot, not silently start the
 * application with a predictable key - that defect existed in the superseded
 * Express prototype (`process.env.JWT_SECRET || 'supersecret...'`) and is the
 * single worst kind of security bug because everything appears to work.
 */

const durationString = z
  .string()
  .regex(/^\d+[smhd]$/, 'must look like "15m", "7d", "60s"');

/**
 * A variable that may legitimately be left blank in `.env`.
 *
 * `SMTP_USER=` (declared, empty) has to mean the same as omitting the line
 * entirely. Without this, a plain `.optional()` accepts the missing case but
 * rejects the empty one with "String must contain at least 1 character(s)" -
 * which is a confusing way to tell someone their commented-out mail setup is
 * fine.
 */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgresql:// URL'),

  /** Comma-separated list of browser origins allowed to call this API. */
  FRONTEND_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: durationString.default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: durationString.default('7d'),

  /**
   * Signs the short-lived ticket the browser presents to the pose service.
   * Separate from the application access secret so that a pose ticket can never
   * be replayed against this API, and vice versa.
   */
  POSE_TICKET_SECRET: z
    .string()
    .min(32, 'POSE_TICKET_SECRET must be at least 32 characters'),
  POSE_TICKET_EXPIRES_IN: durationString.default('2m'),

  /** Shared secret for the pose service -> backend internal channel. */
  POSE_SERVICE_TOKEN: z
    .string()
    .min(32, 'POSE_SERVICE_TOKEN must be at least 32 characters'),
  /** Backend -> pose service, used only for health checks. */
  POSE_SERVICE_URL: z.string().url().default('http://localhost:8000'),

  INVITE_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  /**
   * A session that is created but never activated (camera denied, tab closed)
   * is swept to CANCELLED after this long.
   */
  CREATED_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  /** Hard ceiling on a live session, swept to FAILED. */
  ACTIVE_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  /**
   * Trust `X-Forwarded-For` when deciding a client's IP address.
   *
   * OFF by default, deliberately: the header is client-supplied, so trusting
   * it when the app is directly exposed lets anyone forge an address and walk
   * past the rate limiter.
   *
   * Turn it ON only when something in front actually sets the header - a
   * reverse proxy, or the Vite dev-server proxy used to share the app through
   * a tunnel. Without it in that setup every visitor arrives as 127.0.0.1 and
   * they all share ONE rate-limit bucket, so a handful of testers signing in
   * lock each other out at ten logins a minute.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Path the refresh cookie is scoped to, so it is not sent on every request. */
  REFRESH_COOKIE_PATH: z.string().default('/api/v1/auth'),

  LOG_LEVEL: z
    .enum(['error', 'warn', 'log', 'debug', 'verbose'])
    .default('log'),

  // --- Branding -------------------------------------------------------------
  /** Product name used in emails, notifications and the API description. */
  APP_NAME: z.string().min(1).default('Movera'),
  /**
   * Base URL the emailed links point at - the address a patient's browser
   * opens, which is the FRONTEND, not this API.
   *
   * Optional: when unset it falls back to the first entry of FRONTEND_URL, so
   * a standard local setup needs no extra configuration. Set it explicitly
   * when the browser reaches the app on a different host from the CORS origin
   * (behind a proxy, or a tunnelled demo).
   */
  APP_PUBLIC_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().url().optional(),
  ),

  // --- Email (SMTP) ---------------------------------------------------------
  /**
   * Deliberately OPTIONAL, unlike the secrets above.
   *
   * Requiring them would mean the application refuses to boot on a machine
   * that has no mail credentials - which is every marker's laptop. When they
   * are absent the EmailService falls back to writing each message to the log
   * instead of sending it, and says so loudly at startup.
   *
   * That fallback is a development convenience and nothing more, so
   * `validateEnv` refuses to start a PRODUCTION process with email
   * unconfigured: silently not sending a verification email in production
   * would lock every new user out of their own account.
   */
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  /** e.g. `Movera <no-reply@example.com>`. Defaults to SMTP_USER. */
  SMTP_FROM: optionalString,

  /** How long an emailed verification link stays valid. */
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  /** Password reset links are deliberately much shorter-lived. */
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

/** The three values that must all be present for mail to actually be sent. */
export function isSmtpConfigured(
  env: Pick<Env, 'SMTP_HOST' | 'SMTP_USER' | 'SMTP_PASSWORD'>,
): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (parsed.success && parsed.data.NODE_ENV === 'production') {
    // See the SMTP block above: the log-only fallback is acceptable in
    // development and refused in production.
    if (!isSmtpConfigured(parsed.data)) {
      throw new Error(
        'Invalid environment configuration:\n' +
          '  - SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required when NODE_ENV=production.\n\n' +
          'Without them no verification or password-reset email is delivered, and\n' +
          'every new account is permanently unable to sign in.',
      );
    }
  }

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        `Copy apps/backend/.env.example to apps/backend/.env and fill in the values.\n` +
        `Generate secrets with:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  }

  return parsed.data;
}
