import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { PlaceCategory } from './places.provider.js';
import { PlacesService } from './places.service.js';

export class NearbyQueryDto {
  @ApiProperty({ example: 32.2432 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 77.1892 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 25000, default: 5000, description: 'Search radius in meters' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(25_000)
  radius?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

const DEFAULT_RADIUS_METERS = 5000;
const DEFAULT_LIMIT = 20;

/** Homepage quick actions: what's near me (change request v1.0, change 1). Signed-in users only. */
@ApiTags('places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('location')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('fuel-stations')
  @Throttle(perMinute(RATE_LIMITS.places))
  @ApiOperation({ summary: 'Fuel stations near a point, nearest first.' })
  fuel(@Query() q: NearbyQueryDto) {
    return this.places.nearby(PlaceCategory.FUEL, query(q));
  }

  @Get('restaurants')
  @Throttle(perMinute(RATE_LIMITS.places))
  @ApiOperation({ summary: 'Restaurants, cafés and fast food near a point, nearest first.' })
  restaurants(@Query() q: NearbyQueryDto) {
    return this.places.nearby(PlaceCategory.RESTAURANT, query(q));
  }

  @Get('garages')
  @Throttle(perMinute(RATE_LIMITS.places))
  @ApiOperation({ summary: 'Car/motorcycle repair and tyre shops near a point, nearest first.' })
  garages(@Query() q: NearbyQueryDto) {
    return this.places.nearby(PlaceCategory.GARAGE, query(q));
  }
}

function query(q: NearbyQueryDto) {
  return { lat: q.lat, lng: q.lng, radiusMeters: q.radius ?? DEFAULT_RADIUS_METERS, limit: q.limit ?? DEFAULT_LIMIT };
}
