import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssignmentStatus, Difficulty } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAssignmentDto {
  @ApiProperty({ description: 'PatientProfile.id of a linked patient.' })
  @IsString()
  @Length(1, 64)
  patientId!: string;

  @ApiProperty({ description: 'Exercise.id from the library.' })
  @IsString()
  @Length(1, 64)
  exerciseId!: string;

  @ApiProperty({
    description:
      'RehabilitationPlan.id of the ACTIVE plan this exercise belongs to. ' +
      'Required: an exercise is prescribed as part of a plan of treatment, ' +
      'never on its own.',
  })
  @IsString()
  @Length(1, 64)
  planId!: string;

  @ApiProperty({
    minimum: 1,
    maximum: 20,
    example: 3,
    description: 'Number of sets. targetTotalReps = targetSets x repsPerSet.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  targetSets!: number;

  @ApiProperty({ minimum: 1, maximum: 100, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  repsPerSet!: number;

  @ApiPropertyOptional({
    minimum: 5,
    maximum: 1800,
    example: 60,
    description:
      'HOLD exercises only: seconds of correct alignment to accumulate. ' +
      'Omit to use the exercise default. Ignored for REPS exercises, which ' +
      'are measured in sets x repetitions.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  // Floor of 5s so a goal cannot be met before the patient has settled into
  // position; ceiling of 30 minutes, well beyond any plausible postural drill.
  @Min(5)
  @Max(1800)
  holdSeconds?: number;

  @ApiPropertyOptional({ enum: Difficulty, default: Difficulty.MEDIUM })
  @IsOptional()
  @IsEnum(Difficulty)
  difficulty?: Difficulty;

  @ApiPropertyOptional({ minimum: 1, maximum: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  frequencyPerWeek?: number;

  @ApiPropertyOptional({
    example: [1, 3, 5],
    description: 'ISO weekdays: 1 = Monday .. 7 = Sunday. Empty means any day.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  scheduledDays?: number[];

  @ApiPropertyOptional({
    example: '09:00',
    description: "HH:mm in the patient's timezone. A reminder hint only.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'preferredTime must be HH:mm' })
  preferredTime?: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({
    example: 'Keep your heels flat and pause briefly at the bottom.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;
}

export class UpdateAssignmentDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  targetSets?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  repsPerSet?: number;

  @ApiPropertyOptional({
    minimum: 5,
    maximum: 1800,
    description: 'HOLD exercises only: seconds of correct alignment.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1800)
  holdSeconds?: number;

  @ApiPropertyOptional({ enum: Difficulty })
  @IsOptional()
  @IsEnum(Difficulty)
  difficulty?: Difficulty;

  @ApiPropertyOptional({ minimum: 1, maximum: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  frequencyPerWeek?: number;

  @ApiPropertyOptional({ example: [1, 3, 5] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  scheduledDays?: number[];

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'preferredTime must be HH:mm' })
  preferredTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @ApiPropertyOptional({ enum: AssignmentStatus })
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;
}
