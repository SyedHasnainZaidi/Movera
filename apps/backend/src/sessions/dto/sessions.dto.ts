import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ description: 'An ACTIVE assignment belonging to this patient.' })
  @IsString()
  @Length(1, 64)
  assignmentId!: string;
}

export class PoseTicketResponseDto {
  @ApiProperty({ description: 'Short-lived JWT for the pose WebSocket.' })
  ticket!: string;

  @ApiProperty({ description: 'Seconds until the ticket expires.' })
  expiresIn!: number;
}
