import { validateEnv } from './env.validation';

/**
 * Environment validation is what stops the application booting with a
 * predictable secret. The superseded Express prototype had
 * `process.env.JWT_SECRET || 'supersecret...'`, which meant a missing
 * environment variable produced a working - and completely insecure - server.
 */
describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    POSE_TICKET_SECRET: 'c'.repeat(48),
    POSE_SERVICE_TOKEN: 'd'.repeat(48),
  };

  it('accepts a complete environment and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(env.CREATED_SESSION_TTL_MINUTES).toBe(15);
  });

  it.each([
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'POSE_TICKET_SECRET',
    'POSE_SERVICE_TOKEN',
    'DATABASE_URL',
    'FRONTEND_URL',
  ])('refuses to start when %s is missing', (key) => {
    const broken = { ...valid };
    delete (broken as Record<string, unknown>)[key];
    expect(() => validateEnv(broken)).toThrow(/Invalid environment/);
  });

  it('rejects a secret that is too short to be safe', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(/at least 32 characters/);
  });

  it('rejects a malformed database URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'not-a-url' })).toThrow(
      /Invalid environment/,
    );
  });

  it('rejects a malformed duration string', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_EXPIRES_IN: 'fifteen minutes' }),
    ).toThrow(/Invalid environment/);
  });

  it('coerces numeric strings from the process environment', () => {
    const env = validateEnv({ ...valid, PORT: '4000', THROTTLE_LIMIT: '50' });
    expect(env.PORT).toBe(4000);
    expect(env.THROTTLE_LIMIT).toBe(50);
  });

  it('parses COOKIE_SECURE into a real boolean', () => {
    expect(validateEnv({ ...valid, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(validateEnv({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('names every offending variable in the error message', () => {
    try {
      validateEnv({});
      fail('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      // And tells the developer how to fix it.
      expect(message).toContain('.env.example');
    }
  });
});
