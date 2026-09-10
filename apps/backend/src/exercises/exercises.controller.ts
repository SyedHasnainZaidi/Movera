import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ExercisesService } from './exercises.service';

@ApiBearerAuth('access-token')
@ApiTags('Exercise library')
@Controller({ path: 'exercises', version: '1' })
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @ApiOperation({ summary: 'The exercise library' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.exercises.findAll(includeInactive === 'true');
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One exercise, with its analysis configuration' })
  findOne(@Param('slug') slug: string) {
    return this.exercises.findBySlug(slug);
  }
}
