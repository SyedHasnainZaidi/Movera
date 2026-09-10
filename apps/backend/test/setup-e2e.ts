/**
 * Loads apps/backend/.env before the Nest application is constructed, so the
 * e2e suite runs against the same configuration as the dev server - including
 * POSE_SERVICE_TOKEN, which the internal-channel tests must present.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env') });

// Marks this as the test environment. envSchema restricts NODE_ENV to
// development | test | production, and ConditionalThrottlerGuard uses this
// to disable rate limiting - see that file for why, and what stays active.
process.env.NODE_ENV = 'test';
