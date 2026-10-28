import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { distanceMeters } from '../enrichment/geo.js';
import { REDIS } from '../redis/redis.module.js';
import { PlaceCategory, PlacesProvider, type RawPlace } from './places.provider.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';

const CACHE_TTL_SECONDS = 10 * 60;
// The cache key rounds the position to ~100 m; asking the source for a slightly bigger circle
// means nothing within the real radius is missed when the user isn't exactly at the rounded point.
const CACHE_MARGIN_METERS = 200;

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  limit: number;
}

/**
 * Nearby fuel stations, restaurants and garages for the homepage (change request v1.0, change 1).
 * Results come from the PlacesProvider (OpenStreetMap by default), are cached in Redis for 10
 * minutes per ~100 m area, and are sorted by distance from the user. Redis is optional here:
 * without it every request goes to the source.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    private readonly provider: PlacesProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async nearby(category: PlaceCategory, query: NearbyQuery) {
    const raw = await this.fetch(category, query);
    const places = raw
      .map((p) => ({ ...p, distanceMeters: Math.round(distanceMeters(query.lat, query.lng, p.lat, p.lng)) }))
      .filter((p) => p.distanceMeters <= query.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, query.limit)
      .map((p) => ({ ...p, category }));
    return {
      category,
      center: { lat: query.lat, lng: query.lng },
      radiusMeters: query.radiusMeters,
      source: this.provider.name,
      attribution: this.provider.attribution,
      places,
    };
  }

  private async fetch(category: PlaceCategory, q: NearbyQuery): Promise<RawPlace[]> {
    const lat = round(q.lat, 3);
    const lng = round(q.lng, 3);
    const key = `travelgo:places:${this.provider.name}:${category}:${lat}:${lng}:${q.radiusMeters}`;
    const cached = await this.cacheGet(key);
    if (cached) return cached;

    let places: RawPlace[];
    try {
      places = await this.provider.nearby(category, lat, lng, q.radiusMeters + CACHE_MARGIN_METERS);
    } catch (err) {
      this.logger.warn(`Places lookup failed: ${(err as Error).message}`);
      throw withCode(new ServiceUnavailableException('Nearby places are temporarily unavailable. Try again in a minute.'), ErrorCode.PROVIDER_UNAVAILABLE);
    }
    await this.cacheSet(key, places);
    return places;
  }

  private async cacheGet(key: string): Promise<RawPlace[] | null> {
    if (this.redis.status !== 'ready') return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as RawPlace[]) : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(key: string, places: RawPlace[]): Promise<void> {
    if (this.redis.status !== 'ready') return;
    await this.redis.set(key, JSON.stringify(places), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
