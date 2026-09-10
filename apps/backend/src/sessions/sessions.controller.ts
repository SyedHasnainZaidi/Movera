import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PageDto, PaginationQueryDto } from '../common/dto/pagination.dto';
import { ReportsService } from '../reports/reports.service';
import { CreateSessionDto, PoseTicketResponseDto } from './dto/sessions.dto';
import { SessionsService } from './sessions.service';

@ApiBearerAuth('access-token')
@ApiTags('Exercise sessions')
@Controller({ path: 'sessions', version: '1' })
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly reports: ReportsService,
  ) {}

  @Roles(UserRole.PATIENT)
  @Post()
  @ApiOperation({
    summary: 'Start a session for one of your assigned exercises',
    description:
      'Creates the session in CREATED. It becomes ACTIVE only once the pose ' +
      'service confirms an analyzer is attached and the patient is visible.',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionDto) {
    return this.sessions.create(user, dto.assignmentId);
  }

  @Roles(UserRole.PATIENT)
  @Post(':id/pose-ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mint a short-lived ticket for the pose WebSocket',
    description:
      'Request this AFTER the camera is granted, so the ~2 minute lifetime is ' +
      'spent connecting rather than waiting on a permission prompt.',
  })
  poseTicket(
    @CurrentUser() user: AuthUser,
    @Param('id') sessionId: string,
  ): Promise<PoseTicketResponseDto> {
    return this.sessions.issuePoseTicket(user, sessionId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Session state' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') sessionId: string) {
    return this.sessions.findOne(user, sessionId);
  }

  @Get(':id/reps')
  @ApiOperation({ summary: 'Per-repetition breakdown' })
  listReps(@CurrentUser() user: AuthUser, @Param('id') sessionId: string) {
    return this.sessions.listReps(user, sessionId);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'The generated session report' })
  report(@CurrentUser() user: AuthUser, @Param('id') sessionId: string) {
    return this.reports.getBySessionId(user, sessionId);
  }

  @Roles(UserRole.PATIENT)
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish the session and generate its report',
    description:
      'Idempotent: calling it again returns the same report rather than ' +
      'creating a second one. All totals are computed here from stored ' +
      'repetitions - never taken from the client.',
  })
  complete(@CurrentUser() user: AuthUser, @Param('id') sessionId: string) {
    return this.sessions.complete(user, sessionId);
  }

  @Roles(UserRole.PATIENT)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abandon the session without generating a report' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') sessionId: string) {
    return this.sessions.cancel(user, sessionId);
  }
}

@ApiBearerAuth('access-token')
@ApiTags('Exercise sessions')
@Controller({ path: 'patients', version: '1' })
export class PatientSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('me/sessions')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Your own session history' })
  async mySessions(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ) {
    const { rows, total } = await this.sessions.listForPatient(
      user,
      user.patientProfileId!,
      query.page,
      query.limit,
    );
    return PageDto.of(rows, total, query.page, query.limit);
  }

  @Get(':id/sessions')
  @Roles(UserRole.THERAPIST)
  @ApiOperation({
    summary: "A linked patient's session history",
    description:
      'Requires an ACTIVE therapist-patient link. The path parameter alone ' +
      'grants nothing.',
  })
  async patientSessions(
    @CurrentUser() user: AuthUser,
    @Param('id') patientProfileId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { rows, total } = await this.sessions.listForPatient(
      user,
      patientProfileId,
      query.page,
      query.limit,
    );
    return PageDto.of(rows, total, query.page, query.limit);
  }
}
