import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Password hashing.
 *
 * Argon2id via @node-rs/argon2 rather than the `argon2` npm package: the
 * node-rs build ships prebuilt platform binaries (argon2-win32-x64-msvc here),
 * so `npm install` works on a stock Windows machine with no Visual Studio
 * build tools. That matters for a project that has to run on a supervisor's
 * laptop during a demo.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * Argon2id (19 MiB memory, 2 iterations, parallelism 1).
 */
@Injectable()
export class PasswordService {
  private readonly options = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456, // KiB = 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  /**
   * Returns false rather than throwing on a malformed stored hash, so a
   * corrupt row cannot turn a login attempt into a 500 that leaks internals.
   */
  async verify(plain: string, storedHash: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain, this.options);
    } catch {
      return false;
    }
  }
}
