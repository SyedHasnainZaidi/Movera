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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePlanDto, UpdatePlanDto } from './dto/rehabilitation-plans.dto';
import { RehabilitationPlansService } from './rehabilitation-plans.service';

@ApiBearerAuth('access-token')
@ApiTags('Rehabilitation plans')
@Controller({ path: 'rehabilitation-plans', version: '1' })
export class RehabilitationPlansController {
  constructor(private readonly plans: RehabilitationPlansService) {}

  @Get()
  @ApiOperation({
    summary: 'Plans visible to you',
    description:
      'Patients see their own. Therapists see plans for linked patients only.',
  })
  @ApiQuery({ name: 'patientId', required: false })
  list(@CurrentUser() user: AuthUser, @Query('patientId') patientId?: string) {
    return this.plans.list(user, patientId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One plan with its assignments' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') planId: string) {
    return this.plans.findOne(user, planId);
  }

  @Roles(UserRole.THERAPIST)
  @Post()
  @ApiOperation({
    summary: 'Create a plan for a linked patient',
    description: 'At most one ACTIVE plan per patient.',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.plans.create(user, dto);
  }

  @Roles(UserRole.THERAPIST)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a plan' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plans.update(user, planId, dto);
  }

  @Roles(UserRole.THERAPIST)
  @Delete(':id')
  @ApiOperation({
    summary: 'Remove a plan and the exercises prescribed under it',
    description:
      'Deletes the plan and its assignments outright when NO sessions have ' +
      'been recorded under it. When sessions exist, the plan and its ' +
      'assignments are archived (CANCELLED) instead and the history is kept - ' +
      'a rehabilitation record must not lose completed sessions to a tidy-up. ' +
      'The response reports which of the two happened. Refused with 409 while ' +
      'the patient has a live session on any exercise in the plan.',
  })
  remove(@CurrentUser() user: AuthUser, @Param('id') planId: string) {
    return this.plans.remove(user, planId);
  }
}
