import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTimeout } from '../enrichment/http.js';

/** A named place found by text search. */
export interface FoundPlace {
  /** Same id scheme as nearby places (e.g. "osm:node/123"), so results can be saved directly. */
  providerPlaceId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** e.g. "aeroway", "tourism", "amenity", "natural". */
  category: string | null;
  /** e.g. "aerodrome", "hotel", "restaurant", "beach". */
  type: string | null;
}

/** Search for named places (airports, hotels, beaches…). Abstract so the vendor can be swapped (and faked in tests). */
export abstract class GeocodingProvider {
  abstract readonly name: string;
  abstract readonly attribution: string;
  abstract readonly configured: boolean;
  /** Throws if the provider fails; an error message starting "HTTP 429" means it is rate-limiting us. */
  abstract search(query: string, near: { lat: number; lng: number } | null, limit: number): Promise<FoundPlace[]>;
}

export const DEFAULT_GEOCODING_URL = 'https://nominatim.openstreetmap.org';
const SEARCH_TIMEOUT_MS = 8_000;
/** Nominatim's public server allows at most 1 request per second for the whole app. */
const MIN_INTERVAL_MS = 1_100;
/** Half the side of the box (degrees, ~55 km) that results near the user are preferred in. */
const BIAS_BOX_DEG = 0.5;

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
}

/**
 * OpenStreetMap's Nominatim, matching the rest of the open map stack. The public server
 * (nominatim.openstreetmap.org) has a strict usage policy: 1 request/second, a real User-Agent,
 * results cached, and no search-as-you-type. Fine for development and light use; for production
 * set GEOCODING_URL to a hosted or own instance (same API). GEOCODING_URL=off switches search off.
 */
@Injectable()
export class NominatimGeocodingProvider extends GeocodingProvider {
  readonly name = 'openstreetmap';
  readonly attribution = '© OpenStreetMap contributors';
  private readonly baseUrl: string | null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(config: ConfigService) {
    super();
    const url = config.get<string>('GEOCODING_URL')?.trim();
    this.baseUrl = url === 'off' ? null : (url || DEFAULT_GEOCODING_URL).replace(/\/+$/, '');
  }

  get configured(): boolean {
    return this.baseUrl !== null;
  }

  async search(query: string, near: { lat: number; lng: number } | null, limit: number): Promise<FoundPlace[]> {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(limit), 'accept-language': 'en' });
    if (near) {
      const box = [near.lng - BIAS_BOX_DEG, near.lat + BIAS_BOX_DEG, near.lng + BIAS_BOX_DEG, near.lat - BIAS_BOX_DEG];
      params.set('viewbox', box.map((n) => n.toFixed(4)).join(','));
      params.set('bounded', '0'); // prefer nearby, but still find far-away places
    }
    const res = await this.spaced(() => fetchWithTimeout(`${this.baseUrl}/search?${params}`, SEARCH_TIMEOUT_MS));
    const body = (await res.json()) as NominatimResult[];
    return body.map(toFoundPlace).filter((p): p is FoundPlace => p !== null);
  }

  /** One call at a time, at least MIN_INTERVAL_MS apart. */
  private spaced<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastCallAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function toFoundPlace(r: NominatimResult): FoundPlace | null {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!r.osm_type || r.osm_id === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const display = r.display_name ?? '';
  const name = r.name || display.split(',')[0]?.trim();
  if (!name) return null;
  return {
    providerPlaceId: `osm:${r.osm_type}/${r.osm_id}`,
    name,
    address: display || null,
    lat,
    lng,
    category: r.category ?? null,
    type: r.type ?? null,
  };
}
