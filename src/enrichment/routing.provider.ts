import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTimeout } from './http.js';

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RoadRoute {
  distanceMeters: number;
  durationSeconds: number;
  /** GeoJSON order: [lng, lat]. */
  coordinates: [number, number][];
  /** One per pair of consecutive points. */
  legs: { distanceMeters: number; durationSeconds: number }[];
}

/** Thrown when the points can't be joined by road (e.g. across the sea), as opposed to a provider failure. */
export class NoRoadRouteError extends Error {}

/** Road routing between stops for the trip map. Abstract so the vendor can be swapped (and faked in tests). */
export abstract class RoutingProvider {
  abstract readonly configured: boolean;
  /** e.g. `driving`. */
  abstract readonly profile: string;
  /** Credit line to show with the route. */
  abstract readonly attribution: string;
  /** Road route through the points in order. Throws NoRoadRouteError, or any error on provider failure. */
  abstract route(points: RoutePoint[]): Promise<RoadRoute>;
}

export const DEFAULT_ROUTING_URL = 'https://router.project-osrm.org';

const ROUTE_TIMEOUT_MS = 10_000; // a long multi-stop route takes the server a moment

/**
 * OSRM (OpenStreetMap road data), the same open stack as the map tiles. Defaults to the public
 * demo server, which is fine for development only (no SLA, car profile only, fair-use limits).
 * For production, set ROUTING_URL to a self-hosted OSRM or a hosted one. ROUTING_PROFILE picks
 * the profile (default `driving`). ROUTING_URL=off switches road routes off: the app then gets
 * straight lines between stops.
 */
@Injectable()
export class OsrmRoutingProvider extends RoutingProvider {
  readonly profile: string;
  readonly attribution = 'Routes: OSRM, © OpenStreetMap contributors';
  private readonly baseUrl: string | null;

  constructor(config: ConfigService) {
    super();
    const url = config.get<string>('ROUTING_URL')?.trim();
    this.baseUrl = url === 'off' ? null : (url || DEFAULT_ROUTING_URL).replace(/\/+$/, '');
    this.profile = config.get<string>('ROUTING_PROFILE')?.trim() || 'driving';
  }

  get configured(): boolean {
    return this.baseUrl !== null;
  }

  async route(points: RoutePoint[]): Promise<RoadRoute> {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.baseUrl}/route/v1/${this.profile}/${coords}?overview=full&geometries=geojson&steps=false`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, ROUTE_TIMEOUT_MS);
    } catch (err) {
      // OSRM answers "no route" with HTTP 400 + code NoRoute; fetchWithTimeout turns that into an error.
      if ((err as Error).message.startsWith('HTTP 400')) throw new NoRoadRouteError('No road route between these stops');
      throw err;
    }
    const body = (await res.json()) as {
      code?: string;
      message?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: { distance: number; duration: number }[];
      }[];
    };
    const route = body.routes?.[0];
    if (body.code === 'NoRoute' || (body.code === 'Ok' && !route)) throw new NoRoadRouteError(body.message ?? 'No road route');
    if (body.code !== 'Ok' || !route) throw new Error(`OSRM: ${body.code ?? 'no code'} ${body.message ?? ''}`.trim());
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      coordinates: route.geometry.coordinates,
      legs: route.legs.map((l) => ({ distanceMeters: l.distance, durationSeconds: l.duration })),
    };
  }
}
