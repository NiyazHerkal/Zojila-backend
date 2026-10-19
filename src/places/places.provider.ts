import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTimeout } from '../enrichment/http.js';

export enum PlaceCategory {
  FUEL = 'FUEL',
  RESTAURANT = 'RESTAURANT',
  GARAGE = 'GARAGE',
}

/** A place as the provider returns it, before distances are worked out. */
export interface RawPlace {
  id: string; // provider-specific, stable (e.g. "osm:node/123")
  name: string | null;
  /** What exactly it is, e.g. "fuel", "restaurant", "fast_food", "cafe", "car_repair", "tyres". */
  kind: string;
  lat: number;
  lng: number;
  address: string | null;
  openingHours: string | null; // as the source gives it, e.g. "Mo-Su 06:00-22:00"
  phone: string | null;
  website: string | null;
  brand: string | null;
}

/** Nearby places lookup. Abstract so the source can be swapped (and faked in tests). */
export abstract class PlacesProvider {
  abstract readonly name: string;
  abstract readonly attribution: string;
  /** Throws if the source fails. */
  abstract nearby(category: PlaceCategory, lat: number, lng: number, radiusMeters: number): Promise<RawPlace[]>;
}

// OSM tags per category. Restaurants include fast food, cafés and food courts (what a traveller
// on the road looks for); garages include tyre shops and motorcycle repair (bike trips).
const FILTERS: Record<PlaceCategory, string[]> = {
  [PlaceCategory.FUEL]: ['["amenity"="fuel"]'],
  [PlaceCategory.RESTAURANT]: ['["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]'],
  [PlaceCategory.GARAGE]: ['["shop"~"^(car_repair|tyres|motorcycle_repair)$"]', '["craft"="car_repair"]'],
};
const MAX_RESULTS_FROM_SOURCE = 200;
const OVERPASS_TIMEOUT_MS = 12_000;
const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * OpenStreetMap data through the Overpass API. Free, no key, and matches the project's OSM
 * choice. The public server (overpass-api.de) is for light use; for production set OVERPASS_URL
 * to a hosted/own instance. OSM has no ratings, and opening hours only where mappers added them.
 */
@Injectable()
export class OverpassPlacesProvider extends PlacesProvider {
  readonly name = 'openstreetmap';
  readonly attribution = '© OpenStreetMap contributors';
  private readonly url: string;

  constructor(config: ConfigService) {
    super();
    this.url = config.get<string>('OVERPASS_URL')?.trim() || DEFAULT_OVERPASS_URL;
  }

  async nearby(category: PlaceCategory, lat: number, lng: number, radiusMeters: number): Promise<RawPlace[]> {
    const around = `(around:${Math.round(radiusMeters)},${lat},${lng})`;
    const parts = FILTERS[category].flatMap((f) => [`node${f}${around};`, `way${f}${around};`]);
    const query = `[out:json][timeout:10];(${parts.join('')});out center tags ${MAX_RESULTS_FROM_SOURCE};`;
    const res = await fetchWithTimeout(`${this.url}?data=${encodeURIComponent(query)}`, OVERPASS_TIMEOUT_MS);
    const body = (await res.json()) as { elements?: OverpassElement[] };
    return (body.elements ?? []).map(toRawPlace).filter((p): p is RawPlace => p !== null);
  }
}

export function toRawPlace(el: OverpassElement): RawPlace | null {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat === undefined || lng === undefined) return null;
  const t = el.tags ?? {};
  return {
    id: `osm:${el.type}/${el.id}`,
    name: t.name ?? t['name:en'] ?? t.brand ?? t.operator ?? null,
    kind: t.amenity ?? t.shop ?? t.craft ?? 'other',
    lat,
    lng,
    address: address(t),
    openingHours: t.opening_hours ?? null,
    phone: t.phone ?? t['contact:phone'] ?? null,
    website: t.website ?? t['contact:website'] ?? null,
    brand: t.brand ?? null,
  };
}

function address(t: Record<string, string>): string | null {
  if (t['addr:full']) return t['addr:full'];
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const parts = [street, t['addr:suburb'], t['addr:city'] ?? t['addr:village'] ?? t['addr:town'], t['addr:postcode']].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
