import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AccessModule } from './common/access/access.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ConditionalThrottlerGuard } from './common/guards/conditional-throttler.guard';
import { InternalServiceGuard } from './common/guards/internal-service.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { EmailModule } from './email/email.module';
import { ExerciseAssignmentsModule } from './exercise-assignments/exercise-assignments.module';
import { ExercisesModule } from './exercises/exercises.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PatientsModule } from './patients/patients.module';
import { PrismaModule } from './prisma/prisma.module';
import { RehabilitationPlansModule } from './rehabilitation-plans/rehabilitation-plans.module';
import { ReportsModule } from './reports/reports.module';
import { SessionsModule } from './sessions/sessions.module';
import { TherapistsModule } from './therapists/therapists.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AccessModule,
    EmailModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        { ttl: config.throttleTtlSeconds * 1000, limit: config.throttleLimit },
      ],
    }),

    HealthModule,
    AuthModule,

    PatientsModule,
    TherapistsModule,

    ExercisesModule,
    RehabilitationPlansModule,
    ExerciseAssignmentsModule,

    SessionsModule,
    ReportsModule,
    NotificationsModule,

    // The pose-service channel. Guarded by a shared secret, not user tokens.
    InternalModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Guard order matters. Throttle first so abuse is cheap to reject; then
    // the internal shared-secret check (which short-circuits /internal routes
    // past JWT entirely); then authentication; then role authorization.
    { provide: APP_GUARD, useClass: ConditionalThrottlerGuard },
    { provide: APP_GUARD, useClass: InternalServiceGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
