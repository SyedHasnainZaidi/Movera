import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanStatus } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ description: 'PatientProfile.id of a linked patient.' })
  @IsString()
  @Length(1, 64)
  patientId!: string;

  @ApiProperty({ example: 'Lower Limb Rehabilitation - Phase 2' })
  @IsString()
  @Length(3, 160)
  title!: string;

  @ApiProperty({
    example: 'Restore knee flexion range and build quadriceps endurance.',
    description:
      'What the plan is for. Required: every exercise prescribed under this ' +
      'plan inherits its clinical rationale, and the patient is shown it.',
  })
  @IsString()
  @Length(10, 2000)
  goals!: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ enum: PlanStatus, default: PlanStatus.ACTIVE })
  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 160)
  title?: string;

  // Optional to SEND - omitting it leaves the plan's goals unchanged - but not
  // blankable. Creation requires a description, so an edit must not be a way
  // to end up with a plan that has none.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 2000)
  goals?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ enum: PlanStatus })
  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
