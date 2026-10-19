import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { AlertCategory, MessageType } from '../../database/entities/index.js';

const trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export const ALERT_TYPES = [MessageType.GENERAL, MessageType.CRITICAL, MessageType.SOS] as const;

/** Admin announcement (GENERAL) or critical alert (CRITICAL). */
export class CreateAlertDto {
  @ApiProperty({ enum: [MessageType.GENERAL, MessageType.CRITICAL], example: MessageType.CRITICAL })
  @IsIn([MessageType.GENERAL, MessageType.CRITICAL], { message: 'type must be GENERAL or CRITICAL (use POST …/alerts/sos for SOS)' })
  type!: MessageType.GENERAL | MessageType.CRITICAL;

  @ApiPropertyOptional({ enum: AlertCategory, description: 'Required for CRITICAL, not allowed for GENERAL' })
  @ValidateIf((o: CreateAlertDto) => o.type === MessageType.CRITICAL || o.category !== undefined)
  @IsEnum(AlertCategory, { message: `category must be one of ${Object.values(AlertCategory).join(', ')} (required for CRITICAL)` })
  category?: AlertCategory;

  @ApiProperty({ example: 'Rohtang Pass closed after a landslide. Take the Atal Tunnel.', maxLength: 1000 })
  @trim()
  @IsString()
  @IsNotEmpty({ message: 'body is required' })
  @MaxLength(1000)
  body!: string;
}

/**
 * SOS: every field is optional so the app can fire it with one tap. Send the device's current
 * coordinates if it has them; otherwise the sender's live-location position is used (if sharing).
 */
export class RaiseSosDto {
  @ApiPropertyOptional({ example: 'Bike skidded near Gata Loops, ankle injured', maxLength: 500 })
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  body?: string;

  @ApiPropertyOptional({ example: 32.9, description: 'Send together with lng' })
  @ValidateIf((o: RaiseSosDto) => o.lat !== undefined || o.lng !== undefined)
  @IsLatitude({ message: 'lat and lng must be sent together, as valid coordinates' })
  lat?: number;

  @ApiPropertyOptional({ example: 77.6, description: 'Send together with lat' })
  @ValidateIf((o: RaiseSosDto) => o.lat !== undefined || o.lng !== undefined)
  @IsLongitude({ message: 'lat and lng must be sent together, as valid coordinates' })
  lng?: number;

  @ApiPropertyOptional({ example: 12, description: 'Metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}

export class AlertsQueryDto {
  @ApiPropertyOptional({ description: 'Only unresolved CRITICAL / SOS alerts (the banners to show)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsIn([true, false], { message: 'active must be true or false' })
  active?: boolean;

  @ApiPropertyOptional({ enum: ALERT_TYPES })
  @IsOptional()
  @IsIn(ALERT_TYPES)
  type?: (typeof ALERT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Paging cursor: the previous page’s `nextBefore` (an alert id)' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
