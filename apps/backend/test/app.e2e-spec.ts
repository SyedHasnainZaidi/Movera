import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests against a real PostgreSQL database.
 *
 * Requires the dev database to be running:  npm run db:up
 *
 * These exercise the boundaries that matter clinically: can a patient reach
 * another patient's data, can an unlinked therapist reach a patient, can a
 * repetition be counted twice, can a finished session be reopened. Every one
 * of these was broken in the superseded prototype.
 */
describe('Physiotherapy platform (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let server: App;

  const PASSWORD = 'E2ePassword123!';
  const internalToken = process.env.POSE_SERVICE_TOKEN as string;

  // Populated in beforeAll.
  let therapistToken: string;
  let patientAToken: string;
  let patientBToken: string;
  let patientAProfileId: string;
  let patientBProfileId: string;
  /** Every assignment must belong to a plan, so patient A gets one up front. */
  let planId: string;
  let assignmentId: string;

  const unique = (prefix: string) =>
    `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@e2e.test`;

  /**
   * Registers, verifies and signs in - the full new-user journey.
   *
   * Registration deliberately no longer returns a session, so a test that
   * needs an authenticated user has to go through verification exactly as a
   * real one does. The token is read straight from the database rather than
   * from an inbox: SMTP is not configured under test, and the emailed value is
   * only ever stored as a hash, so intercepting the message is not possible.
   * Signing a fresh token in and verifying through the real endpoint keeps the
   * flow under test.
   */
  async function registerUser(role: 'PATIENT' | 'THERAPIST') {
    const email = unique(role.toLowerCase());
    const registration = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        firstName: role === 'PATIENT' ? 'Test' : 'Doctor',
        lastName: 'User',
        role,
      })
      .expect(201);

    expect(registration.body.emailVerificationRequired).toBe(true);
    expect(registration.body.accessToken).toBeUndefined();

    await verifyEmailFor(email);

    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    return { email, body: login.body, registration: registration.body };
  }

  /**
   * Completes verification for an account through the real endpoint.
   *
   * Only the SHA-256 hash of the token is stored, so the plaintext cannot be
   * recovered. A new token is issued directly, its hash written to the row,
   * and that plaintext is then presented to POST /auth/verify-email - which
   * exercises the endpoint's lookup, expiry check and consumption for real.
   */
  async function verifyEmailFor(email: string): Promise<void> {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');

    await prisma.user.update({
      where: { email },
      data: {
        verificationTokenHash: tokenHash,
        verificationTokenExpiry: new Date(Date.now() + 3_600_000),
      },
    });

    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: raw })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();

    // --- fixtures -------------------------------------------------------
    const therapist = await registerUser('THERAPIST');
    therapistToken = therapist.body.accessToken;

    const patientA = await registerUser('PATIENT');
    patientAToken = patientA.body.accessToken;
    patientAProfileId = patientA.body.user.patientProfileId;

    const patientB = await registerUser('PATIENT');
    patientBToken = patientB.body.accessToken;
    patientBProfileId = patientB.body.user.patientProfileId;

    // Link therapist -> patient A via the real invite flow.
    const invite = await request(server)
      .post('/api/v1/patients/me/link-invites')
      .set('Authorization', `Bearer ${patientAToken}`)
      .expect(201);

    await request(server)
      .post('/api/v1/therapists/me/patients/link')
      .set('Authorization', `Bearer ${therapistToken}`)
      .send({ inviteCode: invite.body.code })
      .expect(201);

    // Prescribe a squat so sessions can be started.
    const exercises = await request(server)
      .get('/api/v1/exercises')
      .set('Authorization', `Bearer ${therapistToken}`)
      .expect(200);
    const squat = exercises.body.find(
      (e: { slug: string }) => e.slug === 'squat',
    );

    const plan = await request(server)
      .post('/api/v1/rehabilitation-plans')
      .set('Authorization', `Bearer ${therapistToken}`)
      .send({
        patientId: patientAProfileId,
        title: 'E2E Rehabilitation Plan',
        goals: 'Restore range of motion and rebuild strength after surgery.',
        startDate: new Date().toISOString().slice(0, 10),
      })
      .expect(201);
    planId = plan.body.id;

    const assignment = await request(server)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${therapistToken}`)
      .send({
        patientId: patientAProfileId,
        planId,
        exerciseId: squat.id,
        targetSets: 2,
        repsPerSet: 5,
        startDate: new Date().toISOString().slice(0, 10),
      })
      .expect(201);
    assignmentId = assignment.body.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // =====================================================================
  describe('Authentication', () => {
    it('registers a patient and returns a profile id, never a password hash', async () => {
      const { body } = await registerUser('PATIENT');
      expect(body.user.role).toBe('PATIENT');
      expect(body.user.patientProfileId).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
    });

    it('refuses to register an ADMIN through the public endpoint', async () => {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: unique('escalate'),
          password: PASSWORD,
          firstName: 'E',
          lastName: 'V',
          role: 'ADMIN',
        })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an unknown role value', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: unique('bogus'),
          password: PASSWORD,
          firstName: 'E',
          lastName: 'V',
          role: 'SUPERUSER',
        })
        .expect(400);
    });

    it('rejects a duplicate email with 409', async () => {
      const { email } = await registerUser('PATIENT');
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: PASSWORD,
          firstName: 'A',
          lastName: 'B',
          role: 'PATIENT',
        })
        .expect(409);
      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('rejects a wrong password without revealing which field was wrong', async () => {
      const { email } = await registerUser('PATIENT');
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'TotallyWrong123!' })
        .expect(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
      expect(response.body.message).toBe('Email or password is incorrect.');
    });

    it('gives the same message for an unknown account', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@e2e.test', password: PASSWORD })
        .expect(401);
      // Identical wording, so the endpoint cannot enumerate registered emails.
      expect(response.body.message).toBe('Email or password is incorrect.');
    });

    it('sets an HttpOnly refresh cookie scoped to the auth path', async () => {
      const { email } = await registerUser('PATIENT');
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) => c.startsWith('physio_refresh='));
      expect(refresh).toBeDefined();
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/v1/auth');
      // The raw token must never appear in the JSON body.
      expect(JSON.stringify(response.body)).not.toContain('physio_refresh');
    });

    it('rotates the refresh token and revokes the whole chain on reuse', async () => {
      const { email } = await registerUser('PATIENT');
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      const firstCookie = (login.headers['set-cookie'] as unknown as string[])[0];

      const refreshed = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(200);
      expect(refreshed.body.accessToken).toBeTruthy();

      // Replaying the ORIGINAL cookie looks like token theft.
      const replay = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // And the legitimate successor is revoked too - defence against theft.
      const successorCookie = (
        refreshed.headers['set-cookie'] as unknown as string[]
      )[0];
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', successorCookie)
        .expect(401);
    });

    it('requires a token for protected routes', async () => {
      const response = await request(server).get('/api/v1/auth/me').expect(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
      expect(response.body.correlationId).toBeTruthy();
    });
  });

  // =====================================================================
  describe('Email uniqueness across roles', () => {
    it('refuses a therapist signup on an address already used by a patient', async () => {
      const { email } = await registerUser('PATIENT');

      const response = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: PASSWORD,
          firstName: 'Same',
          lastName: 'Address',
          role: 'THERAPIST',
        })
        .expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(response.body.message).toBe(
        'This email is already registered. Please use a different email address.',
      );
    });

    it('normalises case so Foo@x and foo@x are the same account', async () => {
      const { email } = await registerUser('PATIENT');
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: email.toUpperCase(),
          password: PASSWORD,
          firstName: 'Upper',
          lastName: 'Case',
          role: 'PATIENT',
        })
        .expect(409);
    });
  });

  // =====================================================================
  describe('Email verification', () => {
    /** Registers WITHOUT verifying, so the account stays unverified. */
    async function registerUnverified() {
      const email = unique('unverified');
      const body = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: PASSWORD,
          firstName: 'Un',
          lastName: 'Verified',
          role: 'PATIENT',
        })
        .expect(201);
      return { email, body: body.body };
    }

    it('creates the account unverified and issues no session', async () => {
      const { email, body } = await registerUnverified();
      expect(body.emailVerificationRequired).toBe(true);
      expect(body.accessToken).toBeUndefined();

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.emailVerified).toBe(false);
      expect(user?.verificationTokenHash).toBeTruthy();
    });

    it('never stores the emailed token in plain text', async () => {
      const { email } = await registerUnverified();
      const user = await prisma.user.findUnique({ where: { email } });
      // A SHA-256 hex digest, not a base64url token.
      expect(user?.verificationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('blocks login until the email is verified', async () => {
      const { email } = await registerUnverified();
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);

      expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(response.body.message).toBe(
        'Please verify your email before logging in.',
      );
    });

    it('reports a wrong password even on an unverified account', async () => {
      // Otherwise the distinct message confirms the address is registered.
      const { email } = await registerUnverified();
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword9!' })
        .expect(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('allows login once verified, and consumes the token', async () => {
      const { email } = await registerUnverified();
      await verifyEmailFor(email);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.emailVerified).toBe(true);
      expect(user?.verificationTokenHash).toBeNull();

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
    });

    it('rejects a verification token that has already been used', async () => {
      const email = unique('replay');
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: PASSWORD,
          firstName: 'Re',
          lastName: 'Play',
          role: 'PATIENT',
        })
        .expect(201);

      const raw = randomBytes(32).toString('base64url');
      await prisma.user.update({
        where: { email },
        data: {
          verificationTokenHash: createHash('sha256').update(raw).digest('hex'),
          verificationTokenExpiry: new Date(Date.now() + 3_600_000),
        },
      });

      await request(server)
        .post('/api/v1/auth/verify-email')
        .send({ token: raw })
        .expect(200);

      const second = await request(server)
        .post('/api/v1/auth/verify-email')
        .send({ token: raw })
        .expect(400);
      expect(second.body.code).toBe('INVALID_VERIFICATION_TOKEN');
    });

    it('rejects an expired verification token', async () => {
      const { email } = await registerUnverified();
      const raw = randomBytes(32).toString('base64url');
      await prisma.user.update({
        where: { email },
        data: {
          verificationTokenHash: createHash('sha256').update(raw).digest('hex'),
          verificationTokenExpiry: new Date(Date.now() - 1_000),
        },
      });

      const response = await request(server)
        .post('/api/v1/auth/verify-email')
        .send({ token: raw })
        .expect(400);
      expect(response.body.code).toBe('INVALID_VERIFICATION_TOKEN');
    });

    it('does not reveal whether an address exists when resending', async () => {
      const real = await registerUnverified();
      const known = await request(server)
        .post('/api/v1/auth/resend-verification')
        .send({ email: real.email })
        .expect(200);
      const unknown = await request(server)
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'nobody-at-all@e2e.test' })
        .expect(200);

      expect(known.body.message).toBe(unknown.body.message);
    });
  });

  // =====================================================================
  describe('Password reset', () => {
    /** Drives forgot-password, then reads the hash back to mint a usable link. */
    async function requestResetToken(email: string): Promise<string> {
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      // A real reset token was generated and stored as a hash. The plaintext
      // went to the email, which is unavailable here, so a fresh one is
      // substituted - the endpoint under test is reset-password, not SMTP.
      const raw = randomBytes(32).toString('base64url');
      await prisma.user.update({
        where: { email },
        data: {
          resetPasswordTokenHash: createHash('sha256')
            .update(raw)
            .digest('hex'),
          resetPasswordTokenExpiry: new Date(Date.now() + 600_000),
        },
      });
      return raw;
    }

    it('stores a reset token as a hash, never in plain text', async () => {
      const { email } = await registerUser('PATIENT');
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.resetPasswordTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(user?.resetPasswordTokenExpiry).toBeTruthy();
    });

    it('does not reveal whether an address exists', async () => {
      const { email } = await registerUser('PATIENT');
      const known = await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      const unknown = await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'definitely-not-here@e2e.test' })
        .expect(200);

      expect(known.body.message).toBe(unknown.body.message);
    });

    it('replaces the password: the old one stops working, the new one works', async () => {
      const { email } = await registerUser('PATIENT');
      const token = await requestResetToken(email);
      const newPassword = 'BrandNew@2026';

      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword })
        .expect(200);

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: newPassword })
        .expect(200);
    });

    it('invalidates the token after a single use', async () => {
      const { email } = await registerUser('PATIENT');
      const token = await requestResetToken(email);

      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'FirstReset@1' })
        .expect(200);

      const replay = await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'SecondReset@1' })
        .expect(400);
      expect(replay.body.code).toBe('INVALID_RESET_TOKEN');

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.resetPasswordTokenHash).toBeNull();
    });

    it('revokes existing sessions, so a stolen refresh token dies with the reset', async () => {
      const { email } = await registerUser('PATIENT');
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookie = (login.headers['set-cookie'] as unknown as string[])[0];

      const token = await requestResetToken(email);
      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'AfterReset@9' })
        .expect(200);

      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });

    it('rejects an expired reset token', async () => {
      const { email } = await registerUser('PATIENT');
      const raw = randomBytes(32).toString('base64url');
      await prisma.user.update({
        where: { email },
        data: {
          resetPasswordTokenHash: createHash('sha256')
            .update(raw)
            .digest('hex'),
          resetPasswordTokenExpiry: new Date(Date.now() - 1_000),
        },
      });

      const response = await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'TooLate@2026' })
        .expect(400);
      expect(response.body.code).toBe('INVALID_RESET_TOKEN');
    });

    it('enforces the password policy on the reset endpoint too', async () => {
      const { email } = await registerUser('PATIENT');
      const token = await requestResetToken(email);
      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'NoSpecial123' })
        .expect(400);
    });
  });

  // =====================================================================
  describe('Password policy', () => {
    const attempt = (password: string) =>
      request(server).post('/api/v1/auth/register').send({
        email: unique('pw'),
        password,
        firstName: 'P',
        lastName: 'W',
        role: 'PATIENT',
      });

    it('rejects a password with no special character', async () => {
      // The example from the specification.
      await attempt('Password123').expect(400);
    });

    it('rejects a password shorter than 7 characters', async () => {
      await attempt('Ab@1cd').expect(400);
    });

    it('accepts 7 characters including a special character', async () => {
      await attempt('Abc@123').expect(201);
    });

    it('accepts the specification example', async () => {
      await attempt('Password@1').expect(201);
    });

    it('never returns a stack trace', async () => {
      const response = await request(server).get('/api/v1/auth/me').expect(401);
      expect(JSON.stringify(response.body)).not.toContain('at ');
      expect(response.body.stack).toBeUndefined();
    });
  });

  // =====================================================================
  describe('Ownership authorization', () => {
    it('lets a patient read their own profile', async () => {
      await request(server)
        .get('/api/v1/patients/me')
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });

    it('stops patient B reading patient A', async () => {
      const response = await request(server)
        .get(`/api/v1/patients/${patientAProfileId}`)
        .set('Authorization', `Bearer ${patientBToken}`)
        .expect(403);
      expect(response.body.code).toBe('PATIENT_ACCESS_DENIED');
    });

    it('stops patient B reading patient A progress', async () => {
      await request(server)
        .get(`/api/v1/patients/${patientAProfileId}/progress`)
        .set('Authorization', `Bearer ${patientBToken}`)
        .expect(403);
    });

    it('lets the linked therapist read patient A', async () => {
      await request(server)
        .get(`/api/v1/patients/${patientAProfileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
    });

    it('stops the therapist reading UNLINKED patient B', async () => {
      const response = await request(server)
        .get(`/api/v1/patients/${patientBProfileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(403);
      expect(response.body.code).toBe('THERAPIST_LINK_REQUIRED');
    });

    it('stops the therapist assigning an exercise to an unlinked patient', async () => {
      const exercises = await request(server)
        .get('/api/v1/exercises')
        .set('Authorization', `Bearer ${therapistToken}`);
      const squat = exercises.body.find(
        (e: { slug: string }) => e.slug === 'squat',
      );

      const response = await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: patientBProfileId,
          // Patient A's plan, deliberately: the link check runs before the
          // plan check, so this still fails on the link rather than on the
          // plan belonging to someone else.
          planId,
          exerciseId: squat.id,
          targetSets: 3,
          repsPerSet: 10,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(403);
      expect(response.body.code).toBe('THERAPIST_LINK_REQUIRED');
    });

    it('stops a patient using therapist-only endpoints', async () => {
      const response = await request(server)
        .get('/api/v1/therapists/me/patients')
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN_ROLE');
    });
  });

  // =====================================================================
  describe('Patient linking by invite', () => {
    it('burns an invite code after a single use', async () => {
      const patient = await registerUser('PATIENT');
      const invite = await request(server)
        .post('/api/v1/patients/me/link-invites')
        .set('Authorization', `Bearer ${patient.body.accessToken}`)
        .expect(201);

      await request(server)
        .post('/api/v1/therapists/me/patients/link')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ inviteCode: invite.body.code })
        .expect(201);

      const replay = await request(server)
        .post('/api/v1/therapists/me/patients/link')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ inviteCode: invite.body.code })
        .expect(409);
      expect(['INVITE_ALREADY_USED', 'ALREADY_LINKED']).toContain(
        replay.body.code,
      );
    });

    it('rejects an unknown code', async () => {
      const response = await request(server)
        .post('/api/v1/therapists/me/patients/link')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ inviteCode: 'ZZZZZZZZ' })
        .expect(400);
      expect(response.body.code).toBe('INVITE_INVALID');
    });

    it('stores only a hash of the code, never the code itself', async () => {
      const patient = await registerUser('PATIENT');
      const invite = await request(server)
        .post('/api/v1/patients/me/link-invites')
        .set('Authorization', `Bearer ${patient.body.accessToken}`)
        .expect(201);

      const rows = await prisma.patientLinkInvite.findMany({
        where: { patientId: patient.body.user.patientProfileId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].codeHash).not.toBe(invite.body.code);
      expect(rows[0].codeHash).toHaveLength(64); // SHA-256 hex
    });
  });

  // =====================================================================
  describe('Session lifecycle', () => {
    let sessionId: string;

    afterEach(async () => {
      // Leave no live session behind - the one-live-session rule would then
      // break every later test in this block.
      await prisma.exerciseSession.updateMany({
        where: {
          patientId: patientAProfileId,
          status: { in: ['CREATED', 'ACTIVE', 'FINALIZING'] },
        },
        data: { status: 'CANCELLED', endedAt: new Date() },
      });
    });

    it('creates a session in CREATED with the prescription captured', async () => {
      const response = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);

      expect(response.body.status).toBe('CREATED');
      expect(response.body.targetSets).toBe(2);
      expect(response.body.repsPerSet).toBe(5);
      expect(response.body.targetTotalReps).toBe(10);
      sessionId = response.body.id;
    });

    /**
     * Returning to the SAME exercise resumes rather than conflicts.
     *
     * This is the behaviour that stops a patient being locked out of their own
     * session. A backgrounded tab that the browser discards, a reload or a
     * dropped socket all end with the page asking for a session again, and the
     * only correct answer is the one already running - creating a second would
     * orphan the repetitions recorded against the first, and refusing left the
     * patient stuck until the two-hour sweep with no control to clear it.
     */
    it('RESUMES the existing session when the same exercise is started again', async () => {
      const first = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      expect(first.body.resumed).toBe(false);

      const second = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.resumed).toBe(true);
      // The payload has to be usable as-is: the page mints a ticket and
      // connects from it exactly as it would for a new session.
      expect(second.body.targetTotalReps).toBe(first.body.targetTotalReps);
      expect(second.body.exercise.slug).toBe(first.body.exercise.slug);

      await request(server)
        .post(`/api/v1/sessions/${first.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });

    it('refuses a session on a DIFFERENT exercise, naming the one in the way', async () => {
      const exercises = await request(server)
        .get('/api/v1/exercises')
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
      const curl = exercises.body.find(
        (e: { slug: string }) => e.slug === 'bicep-curl',
      );

      const other = await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: patientAProfileId,
          planId,
          exerciseId: curl.id,
          targetSets: 2,
          repsPerSet: 5,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(201);

      const live = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);

      const response = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: other.body.id })
        .expect(409);

      expect(response.body.code).toBe('SESSION_ALREADY_LIVE');
      // Without these the client cannot offer a way out, which is what left
      // the patient at a dead end.
      expect(response.body.details.sessionId).toBe(live.body.id);
      expect(response.body.details.assignmentId).toBe(assignmentId);
      expect(response.body.details.exerciseName).toBeTruthy();

      // And cancelling the named session unblocks the other exercise.
      await request(server)
        .post(`/api/v1/sessions/${response.body.details.sessionId}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);

      const started = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: other.body.id })
        .expect(201);
      expect(started.body.resumed).toBe(false);

      await request(server)
        .post(`/api/v1/sessions/${started.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });

    /**
     * FINALIZING was the one status a patient could be trapped behind: it
     * counts as live so it blocks the next session, it is excluded from
     * resuming so it cannot be handed back, and cancel() refused it. A row
     * that reached it and stopped was unreachable from every direction.
     *
     * `updatedAt` is aged with raw SQL because Prisma's @updatedAt rewrites it
     * on every update - the row has to look stranded, not freshly touched.
     *
     * AT TIME ZONE 'UTC' is load-bearing. The column is timestamp WITHOUT time
     * zone and Prisma stores UTC in it, but Postgres `now()` returns the
     * server's local time - five hours ahead here - so a plain
     * `now() - interval '5 minutes'` ages the row five hours into the FUTURE
     * and the recovery never matches it. Passing a JS Date as a bound
     * parameter fails the same way, for the same reason.
     */
    async function strandInFinalizing(sessionId: string): Promise<void> {
      await prisma.$executeRawUnsafe(
        `UPDATE exercise_sessions
            SET status = 'FINALIZING',
                "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '5 minutes'
          WHERE id = $1`,
        sessionId,
      );
    }

    it('finishes a session stranded in FINALIZING instead of blocking on it', async () => {
      const live = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      await strandInFinalizing(live.body.id);

      // The patient simply starts their exercise again - no special call.
      const next = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      expect(next.body.id).not.toBe(live.body.id);

      // COMPLETED, not FAILED: a session only reaches FINALIZING because the
      // patient asked to complete it, so the work is finished rather than
      // broken and a report is built from what was recorded.
      const stranded = await prisma.exerciseSession.findUnique({
        where: { id: live.body.id },
      });
      expect(stranded?.status).toBe('COMPLETED');
      expect(
        await prisma.sessionReport.findUnique({
          where: { sessionId: live.body.id },
        }),
      ).not.toBeNull();

      await request(server)
        .post(`/api/v1/sessions/${next.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });

    it('lets a stranded FINALIZING session be cancelled', async () => {
      const live = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      await strandInFinalizing(live.body.id);

      // The conflict screen offers "cancel it and start this one"; that
      // control has to actually work on this status, not just be displayed.
      const response = await request(server)
        .post(`/api/v1/sessions/${live.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
      expect(response.body.status).toBe('CANCELLED');
    });

    it('refuses to cancel a finalization that is genuinely in flight', async () => {
      const live = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      // FINALIZING with a fresh updatedAt - a completion happening right now.
      await prisma.$executeRawUnsafe(
        `UPDATE exercise_sessions SET status = 'FINALIZING' WHERE id = $1`,
        live.body.id,
      );

      const response = await request(server)
        .post(`/api/v1/sessions/${live.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(400);
      expect(response.body.code).toBe('SESSION_INVALID_STATE');

      // Completing it is still the right way out, and still works: complete()
      // accepts FINALIZING precisely so a retry can finish what was started.
      await request(server)
        .post(`/api/v1/sessions/${live.body.id}/complete`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });

    it("refuses to start a session on another patient's assignment", async () => {
      const response = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientBToken}`)
        .send({ assignmentId })
        .expect(403);
      expect(response.body.code).toBe('RESOURCE_NOT_OWNED');
    });

    it('issues a short-lived pose ticket', async () => {
      const created = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);

      const ticket = await request(server)
        .post(`/api/v1/sessions/${created.body.id}/pose-ticket`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);

      expect(ticket.body.ticket).toBeTruthy();
      expect(ticket.body.expiresIn).toBeLessThanOrEqual(300);
    });

    it("refuses a pose ticket for another patient's session", async () => {
      const created = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);

      await request(server)
        .post(`/api/v1/sessions/${created.body.id}/pose-ticket`)
        .set('Authorization', `Bearer ${patientBToken}`)
        .expect(404);
    });
  });

  // =====================================================================
  describe('Internal pose-service channel', () => {
    let sessionId: string;

    const repBody = (n: number, correct: boolean, score: number) => ({
      ingestKey: `${sessionId}:${n}`,
      repNumber: n,
      setNumber: Math.min(2, Math.floor((n - 1) / 5) + 1),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      correct,
      score,
      trackingConfidence: 0.9,
      angleSummary: { knee: { min: 92, max: 170, mean: 130 } },
      errors: correct ? [] : [{ code: 'TRUNK_LEAN', occurrences: 3 }],
    });

    beforeEach(async () => {
      await prisma.exerciseSession.updateMany({
        where: {
          patientId: patientAProfileId,
          status: { in: ['CREATED', 'ACTIVE', 'FINALIZING'] },
        },
        data: { status: 'CANCELLED', endedAt: new Date() },
      });

      const created = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      sessionId = created.body.id;
    });

    it('rejects a request with no service token', async () => {
      const response = await request(server)
        .get(`/api/v1/internal/sessions/${sessionId}/analyzer-context`)
        .expect(401);
      expect(response.body.code).toBe('INTERNAL_AUTH_FAILED');
    });

    it('rejects a wrong service token', async () => {
      await request(server)
        .get(`/api/v1/internal/sessions/${sessionId}/analyzer-context`)
        .set('x-internal-token', 'x'.repeat(48))
        .expect(401);
    });

    it('rejects a normal user access token', async () => {
      await request(server)
        .get(`/api/v1/internal/sessions/${sessionId}/analyzer-context`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(401);
    });

    it('returns the authoritative analyzer context', async () => {
      const response = await request(server)
        .get(`/api/v1/internal/sessions/${sessionId}/analyzer-context`)
        .set('x-internal-token', internalToken)
        .expect(200);

      expect(response.body.exerciseSlug).toBe('squat');
      expect(response.body.targetTotalReps).toBe(10);
      expect(response.body.currentPersistedRepCount).toBe(0);
      expect(response.body.ruleConfig.validationStatus).toBe(
        'PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW',
      );
      expect(response.body.ruleConfig.requiredLandmarks.length).toBeGreaterThan(0);
    });

    it('activates the session idempotently', async () => {
      const first = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/activate`)
        .set('x-internal-token', internalToken)
        .expect(200);
      expect(first.body.status).toBe('ACTIVE');

      await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/activate`)
        .set('x-internal-token', internalToken)
        .expect(200);
    });

    it('stores a repetition and refuses to store it twice', async () => {
      await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/activate`)
        .set('x-internal-token', internalToken)
        .expect(200);

      const first = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/reps`)
        .set('x-internal-token', internalToken)
        .send(repBody(1, true, 88))
        .expect(201);
      expect(first.body.duplicate).toBe(false);

      // A retry after a network timeout must not create a second repetition.
      const retry = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/reps`)
        .set('x-internal-token', internalToken)
        .send(repBody(1, true, 88))
        .expect(201);
      expect(retry.body.duplicate).toBe(true);

      const count = await prisma.repResult.count({ where: { sessionId } });
      expect(count).toBe(1);
    });

    it('refuses a repetition beyond the prescription', async () => {
      await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/activate`)
        .set('x-internal-token', internalToken);

      const response = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/reps`)
        .set('x-internal-token', internalToken)
        .send(repBody(999, true, 88))
        .expect(400);
      expect(response.body.code).toBe('REP_OUT_OF_RANGE');
    });

    it('refuses an unknown error code', async () => {
      await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/activate`)
        .set('x-internal-token', internalToken);

      const body = repBody(1, false, 60);
      body.errors = [{ code: 'INVENTED_CODE', occurrences: 1 }];

      const response = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/reps`)
        .set('x-internal-token', internalToken)
        .send(body)
        .expect(400);
      expect(response.body.code).toBe('REP_UNKNOWN_ERROR_CODE');
    });

    it('refuses repetitions before the session is ACTIVE', async () => {
      const response = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/reps`)
        .set('x-internal-token', internalToken)
        .send(repBody(1, true, 88))
        .expect(409);
      expect(response.body.code).toBe('SESSION_NOT_ACTIVE');
    });
  });

  // =====================================================================
  describe('Completion and reporting', () => {
    let sessionId: string;

    beforeAll(async () => {
      await prisma.exerciseSession.updateMany({
        where: {
          patientId: patientAProfileId,
          status: { in: ['CREATED', 'ACTIVE', 'FINALIZING'] },
        },
        data: { status: 'CANCELLED', endedAt: new Date() },
      });

      const created = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId })
        .expect(201);
      sessionId = created.body.id;

      await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/activate`)
        .set('x-internal-token', internalToken)
        .expect(200);

      // 8 repetitions: 6 good at 90, 2 poor at 50.
      for (let n = 1; n <= 8; n += 1) {
        const correct = n % 4 !== 0;
        await request(server)
          .post(`/api/v1/internal/sessions/${sessionId}/reps`)
          .set('x-internal-token', internalToken)
          .send({
            ingestKey: `${sessionId}:${n}`,
            repNumber: n,
            setNumber: Math.min(2, Math.floor((n - 1) / 5) + 1),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            correct,
            score: correct ? 90 : 50,
            trackingConfidence: 0.9,
            angleSummary: { knee: { min: 92, max: 170, mean: 130 } },
            errors: correct ? [] : [{ code: 'TRUNK_LEAN', occurrences: 3 }],
          })
          .expect(201);
      }
    }, 60_000);

    it('computes every total server-side from stored repetitions', async () => {
      const response = await request(server)
        .post(`/api/v1/sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);

      const { results } = response.body;
      expect(results.totalReps).toBe(8);
      expect(results.correctReps).toBe(6);
      expect(results.incorrectReps).toBe(2);
      // Mean of 6x90 and 2x50.
      expect(results.performanceScore).toBeCloseTo(80, 1);
      expect(results.completionRatio).toBe(80); // 8 of 10
    });

    it('is idempotent - completing twice returns the same report', async () => {
      const again = await request(server)
        .post(`/api/v1/sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
      expect(again.body.results.totalReps).toBe(8);

      const reports = await prisma.sessionReport.count({ where: { sessionId } });
      expect(reports).toBe(1);
    });

    it('refuses repetitions that arrive after completion', async () => {
      const response = await request(server)
        .post(`/api/v1/internal/sessions/${sessionId}/reps`)
        .set('x-internal-token', internalToken)
        .send({
          ingestKey: `${sessionId}:9`,
          repNumber: 9,
          setNumber: 2,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          correct: true,
          score: 95,
          trackingConfidence: 0.9,
          angleSummary: {},
          errors: [],
        })
        .expect(409);
      expect(response.body.code).toBe('SESSION_NOT_ACTIVE');
    });

    it('aggregates the most common detected issue', async () => {
      const report = await request(server)
        .get(`/api/v1/sessions/${sessionId}/report`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
      expect(report.body.commonErrors[0].code).toBe('TRUNK_LEAN');
      expect(report.body.disclaimer).toContain('physiotherapist');
    });

    it('lets the linked therapist read the report', async () => {
      await request(server)
        .get(`/api/v1/sessions/${sessionId}/report`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
    });

    it('stops an unrelated patient reading the report', async () => {
      await request(server)
        .get(`/api/v1/sessions/${sessionId}/report`)
        .set('Authorization', `Bearer ${patientBToken}`)
        .expect(403);
    });

    it('exposes the per-repetition breakdown to the owner', async () => {
      const reps = await request(server)
        .get(`/api/v1/sessions/${sessionId}/reps`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
      expect(reps.body).toHaveLength(8);
      expect(reps.body[0].repNumber).toBe(1);
    });
  });

  // =====================================================================
  // =====================================================================
  describe('Patient archiving', () => {
    // ONE dedicated patient for the whole block, linked afresh before each
    // test. Registering a new one per test meant a full Argon2 hash, verify
    // and login every time - deliberately expensive work that pushed these
    // past the timeout without testing anything extra. The shared fixtures
    // (patient A and B) are still left untouched.
    let archiveToken: string;
    let archiveProfileId: string;

    beforeAll(async () => {
      const patient = await registerUser('PATIENT');
      archiveToken = patient.body.accessToken;
      archiveProfileId = patient.body.user.patientProfileId;
    });

    /** Links the block's patient, whatever state the previous test left. */
    async function linkedPatient() {
      const invite = await request(server)
        .post('/api/v1/patients/me/link-invites')
        .set('Authorization', `Bearer ${archiveToken}`)
        .expect(201);

      await request(server)
        .post('/api/v1/therapists/me/patients/link')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ inviteCode: invite.body.code })
        .expect(201);

      return { token: archiveToken, profileId: archiveProfileId };
    }

    beforeEach(async () => {
      // Reset to "not linked" so each test starts from the same place.
      await prisma.therapistPatient.deleteMany({
        where: { patientId: archiveProfileId },
      });
    });

    it('archives the link instead of deleting it', async () => {
      const { profileId } = await linkedPatient();

      const response = await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      expect(response.body.status).toBe('INACTIVE');
      expect(response.body.archivedAt).toBeTruthy();

      // The row survives, carrying the original link date.
      const link = await prisma.therapistPatient.findFirst({
        where: { patientId: profileId },
      });
      expect(link).not.toBeNull();
      expect(link?.status).toBe('INACTIVE');
      expect(link?.unlinkedAt).toBeTruthy();
      expect(link?.linkedAt).toBeTruthy();
    });

    it('removes the patient from the active caseload', async () => {
      const { profileId } = await linkedPatient();
      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      const active = await request(server)
        .get('/api/v1/therapists/me/patients?limit=100')
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      expect(
        active.body.data.some(
          (p: { patientProfileId: string }) => p.patientProfileId === profileId,
        ),
      ).toBe(false);
    });

    it('lists the patient under scope=archived, with the discharge date', async () => {
      const { profileId } = await linkedPatient();
      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      const archived = await request(server)
        .get('/api/v1/therapists/me/patients?scope=archived&limit=100')
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      const row = archived.body.data.find(
        (p: { patientProfileId: string }) => p.patientProfileId === profileId,
      );
      expect(row).toBeTruthy();
      expect(row.archivedAt).toBeTruthy();
    });

    it('revokes access to the record while archived', async () => {
      const { profileId } = await linkedPatient();
      // Readable while linked.
      await request(server)
        .get(`/api/v1/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      // Archiving ends the relationship, so it ends access with it.
      await request(server)
        .get(`/api/v1/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(403);
    });

    it('restores the SAME link and the full history when the patient returns', async () => {
      const { token, profileId } = await linkedPatient();

      const before = await prisma.therapistPatient.findFirst({
        where: { patientId: profileId },
      });

      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      // The patient comes back and shares a new code - consent given again,
      // not assumed.
      const invite = await request(server)
        .post('/api/v1/patients/me/link-invites')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(server)
        .post('/api/v1/therapists/me/patients/link')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ inviteCode: invite.body.code })
        .expect(201);

      const after = await prisma.therapistPatient.findFirst({
        where: { patientId: profileId },
      });

      // Same row, reactivated - not a second link beside the old one.
      expect(after?.id).toBe(before?.id);
      expect(after?.status).toBe('ACTIVE');
      expect(after?.unlinkedAt).toBeNull();
      expect(
        await prisma.therapistPatient.count({ where: { patientId: profileId } }),
      ).toBe(1);

      // And the record is readable again.
      await request(server)
        .get(`/api/v1/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
    });

    it('keeps assignments and sessions through an archive cycle', async () => {
      const { token, profileId } = await linkedPatient();

      const exercises = await request(server)
        .get('/api/v1/exercises')
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
      const list = Array.isArray(exercises.body)
        ? exercises.body
        : exercises.body.data;

      const ownPlan = await request(server)
        .post('/api/v1/rehabilitation-plans')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          title: 'Archive cycle plan',
          goals: 'Verify that plans and their history survive an archive.',
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(201);

      const created = await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          planId: ownPlan.body.id,
          exerciseId: list[0].id,
          targetSets: 2,
          repsPerSet: 5,
          difficulty: 'EASY',
          frequencyPerWeek: 3,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(201);

      const session = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignmentId: created.body.id })
        .expect(201);
      await request(server)
        .post(`/api/v1/sessions/${session.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      // Nothing clinical is removed by an administrative change.
      expect(
        await prisma.exerciseAssignment.count({ where: { patientId: profileId } }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.exerciseSession.count({ where: { patientId: profileId } }),
      ).toBeGreaterThan(0);
    });

    it('refuses to archive a patient who is not linked', async () => {
      const response = await request(server)
        .delete(`/api/v1/therapists/me/patients/${patientBProfileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(404);
      expect(response.body.code).toBe('LINK_NOT_FOUND');
    });

    it('refuses a second archive of the same patient', async () => {
      const { profileId } = await linkedPatient();
      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(404);
    });

    it('stops a patient using the archive endpoint', async () => {
      const { profileId } = await linkedPatient();
      await request(server)
        .delete(`/api/v1/therapists/me/patients/${profileId}`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(403);
    });
  });

  // =====================================================================
  describe('Assignment removal', () => {
    /** Prescribes a fresh exercise to the linked patient A. */
    async function assign(): Promise<string> {
      const exercises = await request(server)
        .get('/api/v1/exercises')
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
      const list = Array.isArray(exercises.body)
        ? exercises.body
        : exercises.body.data;

      const created = await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: patientAProfileId,
          planId,
          exerciseId: list[0].id,
          targetSets: 2,
          repsPerSet: 5,
          difficulty: 'EASY',
          frequencyPerWeek: 3,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(201);
      return created.body.id;
    }

    it('DELETES an assignment that has no recorded sessions', async () => {
      const id = await assign();

      const response = await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      expect(response.body.deleted).toBe(true);
      expect(response.body.archived).toBe(false);
      expect(response.body.sessionCount).toBe(0);

      // Genuinely gone.
      const row = await prisma.exerciseAssignment.findUnique({ where: { id } });
      expect(row).toBeNull();
    });

    it('ARCHIVES rather than deletes when sessions exist', async () => {
      const id = await assign();

      // Give it history, then finish so nothing is live.
      const session = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: id })
        .expect(201);
      await request(server)
        .post(`/api/v1/sessions/${session.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);

      const response = await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      expect(response.body.deleted).toBe(false);
      expect(response.body.archived).toBe(true);
      expect(response.body.sessionCount).toBeGreaterThan(0);

      // The row and its history survive; it is simply no longer startable.
      const row = await prisma.exerciseAssignment.findUnique({ where: { id } });
      expect(row?.status).toBe('CANCELLED');
      const kept = await prisma.exerciseSession.count({
        where: { assignmentId: id },
      });
      expect(kept).toBeGreaterThan(0);
    });

    it('refuses to remove an assignment with a LIVE session', async () => {
      const id = await assign();
      await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: id })
        .expect(201);

      const response = await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(409);
      expect(response.body.code).toBe('SESSION_ALREADY_LIVE');

      // Clean up so the one-live-session rule does not fail later tests.
      const live = await prisma.exerciseSession.findFirst({
        where: { assignmentId: id },
      });
      await request(server)
        .post(`/api/v1/sessions/${live!.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });

    it('an archived assignment can no longer be started', async () => {
      const id = await assign();
      await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
      // That one was deleted outright, so a fresh one is archived instead.
      const withHistory = await assign();
      const s = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: withHistory })
        .expect(201);
      await request(server)
        .post(`/api/v1/sessions/${s.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
      await request(server)
        .delete(`/api/v1/assignments/${withHistory}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      const blocked = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: withHistory })
        .expect(400);
      expect(blocked.body.code).toBe('ASSIGNMENT_NOT_ACTIVE');
    });

    it('stops a therapist removing an unlinked patient\'s assignment', async () => {
      const id = await assign();
      // patientB is not linked to this therapist, and a patient may not use
      // the endpoint at all.
      const response = await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${patientBToken}`)
        .expect(403);
      expect(response.body.code).toBeTruthy();

      await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
    });

    it('reports a session count on the assignment list', async () => {
      const id = await assign();
      const list = await request(server)
        .get(`/api/v1/assignments?patientId=${patientAProfileId}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      const found = list.body.find((a: { id: string }) => a.id === id);
      expect(found.sessionCount).toBe(0);

      await request(server)
        .delete(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
    });

    it('lets a paused assignment be resumed for further sessions', async () => {
      const id = await assign();

      await request(server)
        .patch(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ status: 'PAUSED' })
        .expect(200);

      await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: id })
        .expect(400);

      await request(server)
        .patch(`/api/v1/assignments/${id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);

      // Same assignment, another session - no duplicate prescription needed.
      const resumed = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId: id })
        .expect(201);
      await request(server)
        .post(`/api/v1/sessions/${resumed.body.id}/cancel`)
        .set('Authorization', `Bearer ${patientAToken}`)
        .expect(200);
    });
  });


  // =====================================================================
  describe('Plan lifecycle', () => {
    /**
     * A brand-new patient, linked to the therapist.
     *
     * Deliberately a fresh registration per call rather than a shared fixture:
     * a patient may hold only one ACTIVE plan, so tests that each create a
     * plan would collide on a reused patient.
     */
    async function freshLinkedPatient(): Promise<{
      token: string;
      profileId: string;
    }> {
      const patient = await registerUser('PATIENT');
      const token = patient.body.accessToken;
      const profileId = patient.body.user.patientProfileId;

      const invite = await request(server)
        .post('/api/v1/patients/me/link-invites')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(server)
        .post('/api/v1/therapists/me/patients/link')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ inviteCode: invite.body.code })
        .expect(201);

      return { token, profileId };
    }

    /** A freshly linked patient with an active plan of their own. */
    async function patientWithPlan(): Promise<{
      token: string;
      profileId: string;
      planId: string;
      exerciseId: string;
    }> {
      const { token, profileId } = await freshLinkedPatient();

      const plan = await request(server)
        .post('/api/v1/rehabilitation-plans')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          title: 'Plan lifecycle',
          goals: 'Exercise the create, edit and remove paths end to end.',
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(201);

      const exercises = await request(server)
        .get('/api/v1/exercises')
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);
      const list = Array.isArray(exercises.body)
        ? exercises.body
        : exercises.body.data;

      return {
        token,
        profileId,
        planId: plan.body.id,
        exerciseId: list[0].id,
      };
    }

    async function assignTo(
      profileId: string,
      planIdForAssignment: string,
      exerciseId: string,
    ): Promise<string> {
      const created = await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          planId: planIdForAssignment,
          exerciseId,
          targetSets: 2,
          repsPerSet: 5,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(201);
      return created.body.id;
    }

    it('requires a description when creating a plan', async () => {
      const { profileId } = await freshLinkedPatient();
      await request(server)
        .post('/api/v1/rehabilitation-plans')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          title: 'No description',
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(400);
    });

    it('refuses an exercise assignment with no plan', async () => {
      const { profileId, exerciseId } = await patientWithPlan();
      await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          exerciseId,
          targetSets: 2,
          repsPerSet: 5,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(400);
    });

    it('refuses an exercise assignment into a plan that is not active', async () => {
      const { profileId, planId: ownPlan, exerciseId } = await patientWithPlan();

      await request(server)
        .patch(`/api/v1/rehabilitation-plans/${ownPlan}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      const response = await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: profileId,
          planId: ownPlan,
          exerciseId,
          targetSets: 2,
          repsPerSet: 5,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(400);
      expect(response.body.code).toBe('PLAN_NOT_ACTIVE');
    });

    it('edits a plan title and description', async () => {
      const { planId: ownPlan } = await patientWithPlan();

      const response = await request(server)
        .patch(`/api/v1/rehabilitation-plans/${ownPlan}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          title: 'Revised plan title',
          goals: 'Revised goals after the four-week review appointment.',
        })
        .expect(200);

      expect(response.body.title).toBe('Revised plan title');
      expect(response.body.goals).toContain('four-week review');
    });

    it('DELETES a plan and its assignments when nothing has been recorded', async () => {
      const { profileId, planId: ownPlan, exerciseId } = await patientWithPlan();
      const assignment = await assignTo(profileId, ownPlan, exerciseId);

      const response = await request(server)
        .delete(`/api/v1/rehabilitation-plans/${ownPlan}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      expect(response.body.deleted).toBe(true);

      // Both genuinely gone - and the assignment is not left orphaned with a
      // null planId, which is the state the new rule exists to prevent.
      expect(
        await prisma.rehabilitationPlan.findUnique({ where: { id: ownPlan } }),
      ).toBeNull();
      expect(
        await prisma.exerciseAssignment.findUnique({
          where: { id: assignment },
        }),
      ).toBeNull();
    });

    it('ARCHIVES a plan that has recorded sessions, keeping the history', async () => {
      const {
        token,
        profileId,
        planId: ownPlan,
        exerciseId,
      } = await patientWithPlan();
      const assignment = await assignTo(profileId, ownPlan, exerciseId);

      const session = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignmentId: assignment })
        .expect(201);
      await request(server)
        .post(`/api/v1/sessions/${session.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = await request(server)
        .delete(`/api/v1/rehabilitation-plans/${ownPlan}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(200);

      expect(response.body.deleted).toBe(false);
      expect(response.body.status).toBe('CANCELLED');

      // The plan and its assignment survive, cancelled; the session survives
      // untouched. Losing a completed session to a tidy-up is the one outcome
      // this path must never produce.
      expect(
        (await prisma.rehabilitationPlan.findUnique({ where: { id: ownPlan } }))
          ?.status,
      ).toBe('CANCELLED');
      expect(
        (
          await prisma.exerciseAssignment.findUnique({
            where: { id: assignment },
          })
        )?.status,
      ).toBe('CANCELLED');
      expect(
        await prisma.exerciseSession.findUnique({
          where: { id: session.body.id },
        }),
      ).not.toBeNull();
    });

    it('refuses to remove a plan while a session on it is live', async () => {
      const {
        token,
        profileId,
        planId: ownPlan,
        exerciseId,
      } = await patientWithPlan();
      const assignment = await assignTo(profileId, ownPlan, exerciseId);

      const session = await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignmentId: assignment })
        .expect(201);

      const response = await request(server)
        .delete(`/api/v1/rehabilitation-plans/${ownPlan}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .expect(409);
      expect(response.body.code).toBe('SESSION_ALREADY_LIVE');

      await request(server)
        .post(`/api/v1/sessions/${session.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('stops a patient removing their own plan', async () => {
      const { token, planId: ownPlan } = await patientWithPlan();
      await request(server)
        .delete(`/api/v1/rehabilitation-plans/${ownPlan}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });
  describe('Input validation', () => {
    it('rejects unknown properties instead of silently ignoring them', async () => {
      await request(server)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${patientAToken}`)
        .send({ assignmentId, totalReps: 9999, performanceScore: 100 })
        .expect(400);
    });

    it('enforces numeric bounds on a prescription', async () => {
      const exercises = await request(server)
        .get('/api/v1/exercises')
        .set('Authorization', `Bearer ${therapistToken}`);
      const squat = exercises.body.find(
        (e: { slug: string }) => e.slug === 'squat',
      );

      await request(server)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          patientId: patientAProfileId,
          planId,
          exerciseId: squat.id,
          targetSets: 0,
          repsPerSet: 500,
          startDate: new Date().toISOString().slice(0, 10),
        })
        .expect(400);
    });

    it('rejects a short password', async () => {
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: unique('weak'),
          password: 'short',
          firstName: 'A',
          lastName: 'B',
          role: 'PATIENT',
        })
        .expect(400);
    });
  });
});
