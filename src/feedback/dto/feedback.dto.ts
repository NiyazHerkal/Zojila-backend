import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DevicePlatform, FeedbackCategory, FeedbackStatus } from '../../database/entities/index.js';

export class CreateFeedbackDto {
  @ApiProperty({ enum: FeedbackCategory, example: FeedbackCategory.BUG })
  @IsEnum(FeedbackCategory)
  category!: FeedbackCategory;

  @ApiProperty({ example: 'The expense summary shows the wrong total after editing an expense', maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'How happy you are with the app (1–5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ example: 'expenses/summary', description: 'Where in the app', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  screen?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The trip it is about (you must be a member)' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ example: '0.9.0 (42)', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @ApiPropertyOptional({ enum: DevicePlatform })
  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;

  @ApiPropertyOptional({ example: 'Android 15', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  osVersion?: string;

  @ApiPropertyOptional({ example: 'Pixel 8', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceModel?: string;
}

export class FeedbackQueryDto {
  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ enum: FeedbackCategory })
  @IsOptional()
  @IsEnum(FeedbackCategory)
  category?: FeedbackCategory;

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

export class UpdateFeedbackDto {
  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Triage note, shown to the tester' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  opsNote?: string;
}
