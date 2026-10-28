import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ActivityStatus } from '../../database/entities/index.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SetActivityStatusDto {
  @ApiProperty({ enum: ActivityStatus, example: ActivityStatus.CURRENT })
  @IsEnum(ActivityStatus)
  status!: ActivityStatus;
}

export class CreateActivityUpdateDto {
  @ApiProperty({ example: 'Parking is full, use the lot behind the monastery', maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'Your own id for this update (e.g. a UUID). Re-sending it returns the original instead of a duplicate.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId?: string;
}

export class EditActivityUpdateDto {
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;
}

export class ListActivityUpdatesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Paging cursor: the previous page’s `nextBefore`' })
  @IsOptional()
  @IsUUID()
  before?: string;
}

export class SetAttendanceDto {
  @ApiProperty({ example: true, description: 'true = I have arrived at this stop, false = undo' })
  @IsBoolean()
  arrived!: boolean;
}

export class ArrivalCheckDto {
  @ApiProperty({ example: 32.2433 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 77.1893 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({ example: 12, description: 'Horizontal accuracy of the fix in meters' })
  @IsNumber()
  @Min(0)
  accuracy!: number;

  @ApiPropertyOptional({ example: '2026-10-12T07:15:00.000Z', description: 'When the device took the fix. Default: now.' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
