import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { TherapistsService } from '../therapists/therapists.service';
import { UpdatePatientProfileDto } from './dto/patients.dto';
import { PatientsService } from './patients.service';

@ApiBearerAuth('access-token')
@ApiTags('Patients')
@Controller({ path: 'patients', version: '1' })
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly therapists: TherapistsService,
  ) {}

  @Roles(UserRole.PATIENT)
  @Get('me')
  @ApiOperation({ summary: 'Your own profile' })
  me(@CurrentUser() user: AuthUser) {
    return this.patients.getOwnProfile(user);
  }

  @Roles(UserRole.PATIENT)
  @Patch('me')
  @ApiOperation({ summary: 'Update your own profile' })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePatientProfileDto,
  ) {
    return this.patients.updateOwnProfile(user, dto);
  }

  @Roles(UserRole.PATIENT)
  @Get('me/dashboard')
  @ApiOperation({ summary: 'Patient home screen data' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.patients.dashboard(user);
  }

  @Roles(UserRole.PATIENT)
  @Get('me/progress')
  @ApiOperation({ summary: 'Your deterministic progress metrics' })
  myProgress(@CurrentUser() user: AuthUser) {
    return this.patients.progress(user, user.patientProfileId!);
  }

  @Roles(UserRole.PATIENT)
  @Post('me/link-invites')
  @ApiOperation({
    summary: 'Generate a single-use code to share with your physiotherapist',
    description:
      'Linking is patient-initiated by design: a therapist cannot attach ' +
      'themselves to a patient record just by knowing an email address.',
  })
  createInvite(@CurrentUser() user: AuthUser) {
    return this.therapists.createLinkInvite(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'A patient profile',
    description:
      'Requires an ACTIVE therapist-patient link, or being that patient. ' +
      'The path parameter alone grants nothing.',
  })
  findOne(@CurrentUser() user: AuthUser, @Param('id') patientProfileId: string) {
    return this.patients.getProfileById(user, patientProfileId);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Progress metrics for a linked patient' })
  progress(@CurrentUser() user: AuthUser, @Param('id') patientProfileId: string) {
    return this.patients.progress(user, patientProfileId);
  }
}
