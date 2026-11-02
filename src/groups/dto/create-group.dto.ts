import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Ladakh Ride 2026' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Manali → Leh → Pangong, 9 riders' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ example: '2026-10-10T00:00:00Z', description: 'ISO 8601 date/time' })
  @IsDateString()
  tripStart!: string;

  @ApiProperty({ example: '2026-10-19T00:00:00Z', description: 'ISO 8601 date/time, not before tripStart' })
  @IsDateString()
  tripEnd!: string;

  @ApiPropertyOptional({
    example: 'INR',
    default: 'INR',
    description: 'ISO 4217 code used for every expense in the group. Can only change while the group has no expenses.',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code, e.g. INR' })
  currency?: string;
}
