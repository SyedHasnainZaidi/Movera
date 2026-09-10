import { PasswordService } from './password.service';

describe('PasswordService', () => {
  // Argon2id is deliberately slow (19 MiB, 2 iterations), so these tests need
  // more than Jest's 5 s default.
  jest.setTimeout(30_000);

  const service = new PasswordService();

  it('produces an Argon2id hash, never the plaintext', async () => {
    const hash = await service.hash('DevPassword123!');
    expect(hash).toContain('$argon2id$');
    expect(hash).not.toContain('DevPassword123!');
  });

  it('salts each hash, so identical passwords differ', async () => {
    const [a, b] = await Promise.all([
      service.hash('SamePassword123!'),
      service.hash('SamePassword123!'),
    ]);
    expect(a).not.toEqual(b);
  });

  it('verifies a correct password', async () => {
    const hash = await service.hash('CorrectHorse42!');
    await expect(service.verify('CorrectHorse42!', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('CorrectHorse42!');
    await expect(service.verify('WrongHorse42!', hash)).resolves.toBe(false);
  });

  it('returns false for a corrupt stored hash instead of throwing', async () => {
    // A malformed row must not turn a login attempt into a 500 that leaks
    // internal detail.
    await expect(service.verify('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(service.verify('anything', '')).resolves.toBe(false);
  });

  it('is case sensitive', async () => {
    const hash = await service.hash('CaseMatters1!');
    await expect(service.verify('casematters1!', hash)).resolves.toBe(false);
  });
});
