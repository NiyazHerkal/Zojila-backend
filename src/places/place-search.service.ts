import { HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { distanceMeters } from '../enrichment/geo.js';
import { REDIS } from '../redis/redis.module.js';
import { GeocodingProvider, type FoundPlace } from './geocoding.provider.js';
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

  private async fetch({ q, near, limit }: PlaceSearchQuery): Promise<FoundPlace[]> {
    // Bias rounded to 0.1° (~11 km): nearby users share cache entries, and the box is ±0.5° anyway.
    const bias = near ? { lat: Math.round(near.lat * 10) / 10, lng: Math.round(near.lng * 10) / 10 } : null;
    const key = `travelgo:place-search:${this.provider.name}:${q.toLowerCase()}:${bias ? `${bias.lat}:${bias.lng}` : '-'}:${limit}`;
    const cached = await this.cacheGet(key);
    if (cached) return cached;

    let results: FoundPlace[];
    try {
      results = await this.provider.search(q, bias, limit);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Place search failed: ${message}`);
      if (message.startsWith('HTTP 429')) {
        throw withCode(new HttpException('Place search is busy. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS), ErrorCode.PROVIDER_BUSY);
      }
      throw withCode(new ServiceUnavailableException('Place search is temporarily unavailable. Try again in a minute.'), ErrorCode.PROVIDER_UNAVAILABLE);
    }
    await this.cacheSet(key, results);
    return results;
  }

  private async cacheGet(key: string): Promise<FoundPlace[] | null> {
    if (this.redis.status !== 'ready') return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as FoundPlace[]) : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(key: string, results: FoundPlace[]): Promise<void> {
    if (this.redis.status !== 'ready') return;
    await this.redis.set(key, JSON.stringify(results), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
  }
}
