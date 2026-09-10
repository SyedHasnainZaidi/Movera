import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PageDto, PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  CaseloadQueryDto,
  LinkPatientDto,
  UpdateTherapistProfileDto,
} from './dto/therapists.dto';
import { TherapistsService } from './therapists.service';

@ApiBearerAuth('access-token')
@ApiTags('Therapists')
@Roles(UserRole.THERAPIST)
@Controller({ path: 'therapists', version: '1' })
export class TherapistsController {
  constructor(private readonly therapists: TherapistsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Your own profile' })
  me(@CurrentUser() user: AuthUser) {
    return this.therapists.getProfile(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your own profile' })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTherapistProfileDto,
  ) {
    return this.therapists.updateProfile(user, dto);
  }

  @Get('me/dashboard')
  @ApiOperation({ summary: 'Caseload overview' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.therapists.dashboard(user);
  }

  @Get('me/patients')
  @ApiOperation({
    summary: 'Patients you manage',
    description:
      'scope=archived lists discharged patients instead. That view carries no ' +
      'clinical detail: ending a link ends access to the record, and it is ' +
      'restored only when the patient re-links with a new invite code.',
  })
  async patients(
    @CurrentUser() user: AuthUser,
    @Query() query: CaseloadQueryDto,
  ) {
    const { rows, total } = await this.therapists.listPatients(
      user,
      query.page,
      query.limit,
      query.scope ?? 'active',
    );
    return PageDto.of(rows, total, query.page, query.limit);
  }

  // Rate-limited harder than the global default: this endpoint consumes a
  // secret code and must not be brute-forceable.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('me/patients/link')
  @ApiOperation({
    summary: 'Link a patient using their invite code',
    description: 'The code is single-use and expires. Attempts are rate-limited.',
  })
  link(@CurrentUser() user: AuthUser, @Body() dto: LinkPatientDto) {
    return this.therapists.linkPatientByInvite(user, dto.inviteCode);
  }

  @Delete('me/patients/:id')
  @ApiOperation({
    summary: 'Unlink a patient',
    description:
      'Soft unlink. Plans, assignments and session history are preserved.',
  })
  unlink(@CurrentUser() user: AuthUser, @Param('id') patientProfileId: string) {
    return this.therapists.unlinkPatient(user, patientProfileId);
  }
}
