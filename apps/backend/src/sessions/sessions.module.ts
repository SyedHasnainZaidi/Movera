import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { SessionsCleanupJob } from './sessions.cleanup';
import {
  PatientSessionsController,
  SessionsController,
} from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [SessionsController, PatientSessionsController],
  providers: [SessionsService, SessionsCleanupJob],
  exports: [SessionsService],
})
export class SessionsModule {}
