import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** Liveness: the process is up. Never touches the database. */
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return {
      status: 'ok',
      service: 'physio-backend',
      version: process.env.npm_package_version ?? '1.0.0',
      environment: this.config.nodeEnv,
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: the process can actually serve traffic (database reachable). */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - verifies the database' })
  async ready() {
    const dbOk = await this.prisma.isHealthy();
    return {
      status: dbOk ? 'ready' : 'not-ready',
      checks: { database: dbOk ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    };
  }
}
