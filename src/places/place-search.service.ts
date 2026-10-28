import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { distanceMeters } from '../enrichment/geo.js';
import { REDIS } from '../redis/redis.module.js';
import { GeocodingProvider, OSM_PLACE_ID, type FoundPlace, type PlaceDetails } from './geocoding.provider.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';

/** Place names hardly change; a long cache also keeps us within the public server's policy. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface PlaceSearchQuery {
  q: string;
  near: { lat: number; lng: number } | null;
  limit: number;
}

/**
 * Text search for real places (airports, hotels, beaches, restaurants…) to pin as itinerary
 * stops (backend handover 2026-10-22, P-06). Results come from the GeocodingProvider (Nominatim
 * by default) and are cached in Redis for a day per query + area (~11 km). No match is an empty
 * list, never an invented place.
 */
@Injectable()
export class PlaceSearchService {
  private readonly logger = new Logger(PlaceSearchService.name);

  constructor(
    private readonly provider: GeocodingProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async search(query: PlaceSearchQuery) {
    if (!this.provider.configured) {
      throw withCode(new ServiceUnavailableException('Place search is not configured'), ErrorCode.PROVIDER_UNAVAILABLE);
    }
    const results = await this.fetch(query);
    return {
      query: query.q,
      source: this.provider.name,
      attribution: this.provider.attribution,
      results: results.map((p) => ({
        ...p,
        distanceMeters: query.near ? Math.round(distanceMeters(query.near.lat, query.near.lng, p.lat, p.lng)) : null,
      })),
    };
  }

  /**
   * One place's details (address, opening hours, contact) by the `providerPlaceId` from search,
   * nearby places or a saved place. Cached for a day like search.
   */
  async details(providerPlaceId: string) {
    if (!OSM_PLACE_ID.test(providerPlaceId)) {
      throw new BadRequestException('providerPlaceId must be an OpenStreetMap id like osm:node/123');
    }
    if (!this.provider.configured) {
      throw withCode(new ServiceUnavailableException('Place search is not configured'), ErrorCode.PROVIDER_UNAVAILABLE);
    }
    const key = `travelgo:place-details:${this.provider.name}:${providerPlaceId}`;
    let place = await this.cacheGet<PlaceDetails>(key);
    if (!place) {
      try {
        place = await this.provider.details(providerPlaceId);
      } catch (err) {
        throw this.providerError('Place details', err as Error);
      }
      if (!place) throw new NotFoundException('Place not found');
      await this.cacheSet(key, place);
    }
    return { ...place, source: this.provider.name, attribution: this.provider.attribution };
  }

  private async fetch({ q, near, limit }: PlaceSearchQuery): Promise<FoundPlace[]> {
    // Bias rounded to 0.1° (~11 km): nearby users share cache entries, and the box is ±0.5° anyway.
    const bias = near ? { lat: Math.round(near.lat * 10) / 10, lng: Math.round(near.lng * 10) / 10 } : null;
    const key = `travelgo:place-search:${this.provider.name}:${q.toLowerCase()}:${bias ? `${bias.lat}:${bias.lng}` : '-'}:${limit}`;
    const cached = await this.cacheGet<FoundPlace[]>(key);
    if (cached) return cached;

    let results: FoundPlace[];
    try {
      results = await this.provider.search(q, bias, limit);
    } catch (err) {
      throw this.providerError('Place search', err as Error);
    }
    await this.cacheSet(key, results);
    return results;
  }

  /** 429 when the provider is rate-limiting us, 503 otherwise. */
  private providerError(what: string, err: Error): HttpException {
    this.logger.warn(`${what} failed: ${err.message}`);
    if (err.message.startsWith('HTTP 429')) {
      return withCode(new HttpException(`${what} is busy. Try again in a minute.`, HttpStatus.TOO_MANY_REQUESTS), ErrorCode.PROVIDER_BUSY);
    }
    return withCode(new ServiceUnavailableException(`${what} is temporarily unavailable. Try again in a minute.`), ErrorCode.PROVIDER_UNAVAILABLE);
  }

  private async cacheGet<T>(key: string): Promise<T | null> {
    if (this.redis.status !== 'ready') return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(key: string, results: FoundPlace[] | PlaceDetails): Promise<void> {
    if (this.redis.status !== 'ready') return;
    await this.redis.set(key, JSON.stringify(results), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
  }
}
