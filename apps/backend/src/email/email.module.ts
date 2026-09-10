import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global because four unrelated feature modules send mail (auth, therapists,
 * exercise-assignments and, later, anything else that notifies a user).
 * Re-importing it into each one adds wiring without adding meaning.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
