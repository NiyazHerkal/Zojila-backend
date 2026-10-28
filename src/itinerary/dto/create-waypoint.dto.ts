import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 24-hour wall-clock time, e.g. 09:05 or 18:30. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateWaypointDto {
  @ApiProperty({ example: 'Manali', description: 'Place name shown on the pin' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 32.2432 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 77.1892 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ example: '2026-10-10', description: 'Trip date for this stop (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  date?: string | null;

  @ApiPropertyOptional({
    example: '16:00',
    description: 'Start time (HH:mm, 24 h), local time at the stop like `date`. `null` clears it.',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:mm (00:00-23:59)' })
  startTime?: string | null;

  @ApiPropertyOptional({
    example: '18:30',
    description: 'End time (HH:mm, 24 h). Needs a startTime and must be after it (same day). `null` clears it.',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:mm (00:00-23:59)' })
  endTime?: string | null;

  @ApiPropertyOptional({ example: 'Fuel up before Rohtang Pass' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    example: 'Gol Gumbaz Road, Vijayapura, Karnataka 586101, India',
    description: 'The place’s address, e.g. from place search. `null` clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({
    example: 'osm:way/123456',
    description: 'The `providerPlaceId` from place search or nearby places. `null` clears it.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  providerPlaceId?: string | null;

  @ApiPropertyOptional({
    example: 2,
    description: '1-based position to insert at (1 = new start point). Default: append as the new end point.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  position?: number;
}
