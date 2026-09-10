import { Module } from '@nestjs/common';
import { ExerciseAssignmentsController } from './exercise-assignments.controller';
import { ExerciseAssignmentsService } from './exercise-assignments.service';

@Module({
  controllers: [ExerciseAssignmentsController],
  providers: [ExerciseAssignmentsService],
  exports: [ExerciseAssignmentsService],
})
export class ExerciseAssignmentsModule {}
