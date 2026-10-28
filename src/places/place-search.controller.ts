import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { PlaceSearchService } from './place-search.service.js';

const DEFAULT_LIMIT = 10;

export class PlaceSearchQueryDto {
  @ApiProperty({ example: 'Goa airport', minLength: 2, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({ example: 15.3, description: 'Prefer results near here (send with lng)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 73.9 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

/** Search real places by name (backend handover 2026-10-22, P-06). Signed-in users only. */
@ApiTags('places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('places')
export class PlaceSearchController {
  constructor(private readonly search: PlaceSearchService) {}

  @Get('search')
  @Throttle(perMinute(RATE_LIMITS.placeSearch))
  @ApiOperation({
    summary:
      'Places matching a name (airports, hotels, beaches…), best first. Search when the user submits, not on ' +
      'every keystroke. 429 / 503 if the provider is busy or down; no match = empty results.',
  })
  find(@Query() q: PlaceSearchQueryDto) {
    if ((q.lat === undefined) !== (q.lng === undefined)) throw new BadRequestException('Send lat and lng together');
    return this.search.search({
      q: q.q,
      near: q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null,
      limit: q.limit ?? DEFAULT_LIMIT,
    });
  }
}
