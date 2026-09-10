import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionsService } from './sessions.service';

/**
 * Reclaims sessions nobody finished.
 *
 * A patient who denies camera permission or closes the tab leaves a CREATED
 * row behind. Under the one-live-session rule that row would block their next
 * attempt forever, so it is swept on a schedule rather than left to accumulate.
 */
@Injectable()
export class SessionsCleanupJob {
  private readonly logger = new Logger(SessionsCleanupJob.name);

  constructor(private readonly sessions: SessionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.sessions.sweepStaleSessions();
    } catch (error) {
      this.logger.error(
        'Stale session sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
