import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LiveShareDuration, ShareDuration } from '../../database/entities/index.js';

export class StartSharingDto {
  @ApiProperty({ enum: ShareDuration, description: 'ONE_HOUR / FOUR_HOURS / EIGHT_HOURS, or ALWAYS (until turned off)' })
  @IsEnum(ShareDuration)
  duration!: ShareDuration;
}

export class StartLiveShareDto {
  @ApiProperty({ enum: LiveShareDuration, description: 'FIFTEEN_MINUTES / ONE_HOUR / EIGHT_HOURS' })
  @IsEnum(LiveShareDuration)
  duration!: LiveShareDuration;

  @ApiPropertyOptional({ example: 'Mom', maxLength: 60, description: 'Who it is for. Shown in your list and on their page.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  recipientLabel?: string;
}

export class LocationPointDto {
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

  @ApiPropertyOptional({ example: 8.5, description: 'Horizontal accuracy in meters' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiPropertyOptional({ example: 45, description: 'Direction of travel, degrees from north (0–360)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional({ example: 12.3, description: 'Speed in meters/second' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @ApiPropertyOptional({ example: '2026-10-10T08:30:00.000Z', description: 'When the device took the fix. Default: now.' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

/** One point from the foreground app, or a batch queued up by a background location plugin. */
export class LocationUpdateDto {
  @ApiProperty({ type: [LocationPointDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LocationPointDto)
  points!: LocationPointDto[];
}
