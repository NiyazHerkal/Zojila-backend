import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
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
