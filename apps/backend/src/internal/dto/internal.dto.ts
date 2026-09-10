import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RepErrorDto {
  @ApiProperty({ example: 'TRUNK_LEAN' })
  @IsString()
  @Matches(/^[A-Z_]{3,40}$/, { message: 'code must be an UPPER_SNAKE error code' })
  code!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  occurrences!: number;
}

/**
 * Payload the pose service posts for one completed repetition.
 *
 * Every numeric field is bounded. This arrives over an authenticated internal
 * channel, but it still writes to a clinical record, so it is validated as
 * strictly as any public input.
 */
export class IngestRepDto {
  @ApiProperty({
    description:
      'Deterministic "<sessionId>:<repNumber>". Unique in the database, which is what makes a retry idempotent.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+:\d+$/)
  ingestKey!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  repNumber!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000)
  setNumber!: number;

  @ApiProperty() @IsISO8601() startedAt!: string;
  @ApiProperty() @IsISO8601() completedAt!: string;

  @ApiProperty() @IsBoolean() correct!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  trackingConfidence!: number;

  @ApiPropertyOptional({
    description: 'Per-angle {min,max,mean} for this repetition.',
    example: { knee: { min: 84.2, max: 171, mean: 128.5 } },
  })
  @IsOptional()
  @IsObject()
  angleSummary?: Record<string, Record<string, number>>;

  @ApiPropertyOptional({ type: [RepErrorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepErrorDto)
  errors?: RepErrorDto[];
}

/**
 * Payload the pose service posts for a HOLD exercise's progress.
 *
 * CUMULATIVE, not incremental: every snapshot restates the whole session. That
 * is what makes it safe to post repeatedly and safe to lose - the next one
 * supersedes it - so unlike IngestRepDto it needs no idempotency key. The
 * price is that the numbers must only ever move forward, which the service
 * enforces rather than trusting.
 */
export class IngestHoldDto {
  @ApiProperty({
    minimum: 0,
    maximum: 86_400,
    description: 'Total seconds of correct alignment accumulated so far.',
  })
  @IsNumber()
  @Min(0)
  @Max(86_400)
  heldSec!: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 86_400,
    description: 'Longest unbroken correctly-aligned stretch this session.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86_400)
  bestStreakSec?: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  analysedFrames!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Mean per-frame posture score across the session.',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  meanScore!: number;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  meanConfidence!: number;

  @ApiPropertyOptional({
    description: 'Per-angle {min,max,mean} across the session.',
    example: { spine: { min: 151.2, max: 178.4, mean: 170.1 } },
  })
  @IsOptional()
  @IsObject()
  angleSummary?: Record<string, Record<string, number>>;

  @ApiPropertyOptional({ type: [RepErrorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepErrorDto)
  errors?: RepErrorDto[];
}
