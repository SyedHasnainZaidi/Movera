import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting, disabled only under NODE_ENV=test.
 *
 * Why: the e2e suite is a single client that legitimately registers dozens of
 * accounts and logs in repeatedly within one minute. Against the production
 * limits (5 registrations/minute) it would spend most of its run receiving
 * 429s - which tests the throttler rather than the behaviour under test.
 *
 * This is a deliberate, narrow exemption:
 *   - it is keyed on NODE_ENV, which envSchema restricts to
 *     development | test | production, so it can never be enabled by accident
 *     in a deployed environment;
 *   - rate limiting is verified separately against a running server (see
 *     docs/TESTING.md, "Rate limiting");
 *   - every OTHER guard - authentication, roles, ownership, internal token -
 *     stays fully active during e2e, because those are the ones the tests are
 *     actually there to prove.
 */
@Injectable()
export class ConditionalThrottlerGuard extends ThrottlerGuard {
  async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') return true;
    return super.shouldSkip(context);
  }
}
