import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TripStatus } from '../../database/entities/index.js';

export class SetStatusDto {
  @ApiProperty({ enum: TripStatus, example: TripStatus.IN_TRANSIT })
  @IsEnum(TripStatus)
  status!: TripStatus;

  @ApiPropertyOptional({ example: 'Flat tyre 5 km after Keylong', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  @ApiPropertyOptional({
    example: '2026-10-12T08:30:00.000Z',
    description: 'When the status was set, for updates queued offline. Up to 7 days back; defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @ApiPropertyOptional({ maxLength: 64, description: 'Your own id for this update. Re-sending it returns the original.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId?: string;
}
