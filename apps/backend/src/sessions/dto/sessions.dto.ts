import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BodySide } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ description: 'An ACTIVE assignment belonging to this patient.' })
  @IsString()
  @Length(1, 64)
  assignmentId!: string;

  @ApiPropertyOptional({
    enum: BodySide,
    description:
      'Required for side-specific exercises (sideMode other than NONE) and ' +
      'rejected for the rest. Left and right are always separate sessions.',
  })
  @IsOptional()
  @IsEnum(BodySide)
  side?: BodySide;
}

export class PoseTicketResponseDto {
  @ApiProperty({ description: 'Short-lived JWT for the pose WebSocket.' })
  ticket!: string;

  @ApiProperty({ description: 'Seconds until the ticket expires.' })
  expiresIn!: number;
}
