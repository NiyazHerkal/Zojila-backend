import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Ladakh Ride 2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Manali → Leh → Pangong, 9 riders' })
  @IsString()
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
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code, e.g. INR' })
  currency?: string;
}
