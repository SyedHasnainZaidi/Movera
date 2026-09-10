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
import { AssignmentStatus, UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from './dto/exercise-assignments.dto';
import { ExerciseAssignmentsService } from './exercise-assignments.service';

@ApiBearerAuth('access-token')
@ApiTags('Exercise assignments')
@Controller({ path: 'assignments', version: '1' })
export class ExerciseAssignmentsController {
  constructor(private readonly assignments: ExerciseAssignmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Assignments visible to you',
    description:
      'Patients see their own. Therapists see assignments for linked patients only.',
  })
  @ApiQuery({ name: 'patientId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: AssignmentStatus })
  list(
    @CurrentUser() user: AuthUser,
    @Query('patientId') patientId?: string,
    @Query('status') status?: AssignmentStatus,
  ) {
    return this.assignments.list(user, { patientId, status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'One assignment, with full exercise detail' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') assignmentId: string) {
    return this.assignments.findOne(user, assignmentId);
  }

  @Roles(UserRole.THERAPIST)
  @Post()
  @ApiOperation({
    summary: 'Assign an exercise to a linked patient',
    description:
      'Requires an ACTIVE therapist-patient link and an exercise that has an ' +
      'active analysis configuration.',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.assignments.create(user, dto);
  }

  @Roles(UserRole.THERAPIST)
  @Patch(':id')
  @ApiOperation({
    summary: 'Update, pause or resume an assignment',
    description:
      'Setting status to PAUSED stops the patient starting it; setting it back ' +
      'to ACTIVE lets them run further sessions on the SAME assignment rather ' +
      'than needing a duplicate prescription.',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') assignmentId: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignments.update(user, assignmentId, dto);
  }

  @Roles(UserRole.THERAPIST)
  @Delete(':id')
  @ApiOperation({
    summary: 'Remove an assignment from the patient list',
    description:
      'Deletes the assignment outright when it has NO recorded sessions. When ' +
      'sessions exist it is archived (CANCELLED) instead and the history is ' +
      'kept - a rehabilitation record must not lose completed sessions to a ' +
      'tidy-up. The response reports which of the two happened. Refused with ' +
      '409 while the patient has a live session on it.',
  })
  remove(@CurrentUser() user: AuthUser, @Param('id') assignmentId: string) {
    return this.assignments.remove(user, assignmentId);
  }
}
