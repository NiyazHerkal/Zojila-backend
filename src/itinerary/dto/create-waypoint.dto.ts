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

  @ApiPropertyOptional({ example: 'Fuel up before Rohtang Pass' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    example: 2,
    description: '1-based position to insert at (1 = new start point). Default: append as the new end point.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  position?: number;
}
