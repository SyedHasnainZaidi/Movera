import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePatientProfileDto {
  @ApiPropertyOptional({ example: '+92 300 1234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: '1998-04-12' })
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: 'Post-operative ACL rehabilitation, left knee',
    description:
      'Short free-text context for the therapist. Deliberately not a structured ' +
      'medical history - this prototype stores the minimum needed to run and ' +
      'review exercise sessions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  conditionSummary?: string;

  @ApiPropertyOptional({ example: 'Asia/Karachi' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
