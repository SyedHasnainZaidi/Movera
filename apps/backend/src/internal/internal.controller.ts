import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { IngestHoldDto, IngestRepDto } from './dto/internal.dto';
import { InternalService } from './internal.service';

/**
 * The pose-service -> backend channel.
 *
 * Guarded by InternalServiceGuard (shared secret, constant-time compared), NOT
 * by user credentials. Hidden from the public Swagger document because these
 * routes are not callable from a browser and listing them only invites probing.
 */
@ApiExcludeController()
@ApiTags('Internal')
@Internal()
@Controller({ path: 'internal/sessions', version: '1' })
export class InternalController {
  constructor(private readonly internal: InternalService) {}

  @Get(':id/analyzer-context')
  @ApiOperation({ summary: 'Authoritative analysis configuration for a session' })
  getAnalyzerContext(@Param('id') sessionId: string) {
    return this.internal.getAnalyzerContext(sessionId);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition CREATED -> ACTIVE (idempotent)' })
  activate(@Param('id') sessionId: string) {
    return this.internal.activateSession(sessionId);
  }

  @Post(':id/reps')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Persist one completed repetition (idempotent)' })
  ingestRep(@Param('id') sessionId: string, @Body() dto: IngestRepDto) {
    return this.internal.ingestRep(sessionId, dto);
  }

  @Post(':id/hold')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record cumulative hold progress for a HOLD session (idempotent)',
  })
  ingestHold(@Param('id') sessionId: string, @Body() dto: IngestHoldDto) {
    return this.internal.ingestHold(sessionId, dto);
  }
}
