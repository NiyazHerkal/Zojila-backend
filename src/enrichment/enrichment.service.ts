import { Injectable, Logger } from '@nestjs/common';
import { ElevationProvider } from './elevation.provider.js';
import { distanceMeters } from './geo.js';
import { MapTileProvider } from './map-tile.provider.js';
import {
  planRouteMap,
  type MapPoint,
  type RouteMapPlan,
  type TilePlacement,
} from './route-map.js';
import { NoRoadRouteError, RoutingProvider, type RoutePoint } from './routing.provider.js';
import { WeatherProvider, type DailyForecast } from './weather.provider.js';

export enum WeatherStatus {
  OK = 'OK',
  NOT_CONFIGURED = 'NOT_CONFIGURED', // weather provider switched off (MET Norway needs no key)
  NO_DATE = 'NO_DATE', // the stop has no date, so there's no day to forecast
  NOT_YET_AVAILABLE = 'NOT_YET_AVAILABLE', // too far ahead; see availableFrom
  PAST_DATE = 'PAST_DATE',
  UNAVAILABLE = 'UNAVAILABLE', // provider error/timeout; try refreshing later
}

export interface RouteMap {
  plan: RouteMapPlan;
  tiles: (TilePlacement & { image: Buffer })[];
  attribution: string;
}

export enum RouteStatus {
  OK = 'OK', // every leg follows roads
  PARTIAL = 'PARTIAL', // some legs have no road between them (e.g. across water): straight lines there
  NOT_CONFIGURED = 'NOT_CONFIGURED', // routing switched off (ROUTING_URL=off): straight lines
  UNAVAILABLE = 'UNAVAILABLE', // provider error/timeout: straight lines for now, retried on the next request
}

export interface RouteLeg {
  distanceMeters: number;
  /** Driving time; null for a straight-line leg. */
  durationSeconds: number | null;
  /** false = straight line (no road, or no routing). */
  routed: boolean;
}

export interface TripRoute {
  status: RouteStatus;
  profile: string;
  distanceMeters: number;
  /** Null when any leg isn't routed, since the total time is then unknown. */
  durationSeconds: number | null;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  legs: RouteLeg[];
  attribution: string;
  computedAt: string;
}

export enum RoadStatus {
  OK = 'OK',
  NO_ROUTE = 'NO_ROUTE', // no road joins the points (e.g. across water)
  NOT_CONFIGURED = 'NOT_CONFIGURED', // routing switched off (ROUTING_URL=off)
  UNAVAILABLE = 'UNAVAILABLE', // provider error/timeout: try again later
}

/** A road route between two points; everything but the status is null without a real route. */
export interface RoadBetween {
  status: RoadStatus;
  profile: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  attribution: string;
  computedAt: string;
}

const MAX_MAP_TILES = 40; // a single PDF map needs ~12–24; more means something's off

export interface WeatherResult {
  status: WeatherStatus;
  forecast?: DailyForecast & { provider: string };
  /** For NOT_YET_AVAILABLE: first date the forecast can be fetched (refresh then). */
  availableFrom?: string;
  fetchedAt: string;
}

/**
 * External per-stop data for the itinerary (PDF §2.3.2): elevation, weather, and the PDF's
 * map overview. Always best-effort: a missing key or provider failure returns a status
 * instead of failing the request. Reviews are an open question and not implemented.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    private readonly elevation: ElevationProvider,
    private readonly weather: WeatherProvider,
    private readonly tiles: MapTileProvider,
    private readonly routing: RoutingProvider,
  ) {}

  get routingProfile(): string {
    return this.routing.configured ? this.routing.profile : 'straight';
  }

  get routingAttribution(): string {
    return this.routing.attribution;
  }

  /** Credit line to print wherever forecasts are shown. */
  get weatherAttribution(): string {
    return this.weather.attribution;
  }

  get elevationConfigured(): boolean {
    return this.elevation.configured;
  }

  /** Meters above sea level, or null if not configured / the lookup failed. */
  async elevationFor(lat: number, lng: number): Promise<number | null> {
    if (!this.elevation.configured) return null;
    try {
      return await this.elevation.getElevation(lat, lng);
    } catch (err) {
      this.logger.warn(
        `Elevation lookup failed for ${lat},${lng}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async weatherFor(
    lat: number,
    lng: number,
    date: string | null,
  ): Promise<WeatherResult> {
    const fetchedAt = new Date().toISOString();
    if (!this.weather.configured)
      return { status: WeatherStatus.NOT_CONFIGURED, fetchedAt };
    if (!date) return { status: WeatherStatus.NO_DATE, fetchedAt };

    // Pre-check the window against UTC "today" (±1 day of slack for time zones) to save API calls.
    const today = new Date().toISOString().slice(0, 10);
    const lastForecastDay = addDays(today, this.weather.forecastDays - 1);
    if (date < addDays(today, -1))
      return { status: WeatherStatus.PAST_DATE, fetchedAt };
    if (date > addDays(lastForecastDay, 1)) {
      return {
        status: WeatherStatus.NOT_YET_AVAILABLE,
        availableFrom: addDays(date, -(this.weather.forecastDays - 1)),
        fetchedAt,
      };
    }

    try {
      const day = (await this.weather.getDailyForecast(lat, lng)).find(
        (d) => d.date === date,
      );
      if (!day) {
        return date > today
          ? {
              status: WeatherStatus.NOT_YET_AVAILABLE,
              availableFrom: addDays(date, -(this.weather.forecastDays - 1)),
              fetchedAt,
            }
          : { status: WeatherStatus.PAST_DATE, fetchedAt };
      }
      return {
        status: WeatherStatus.OK,
        forecast: { ...day, provider: this.weather.name },
        fetchedAt,
      };
    } catch (err) {
      this.logger.warn(
        `Weather lookup failed for ${lat},${lng} on ${date}: ${(err as Error).message}`,
      );
      return { status: WeatherStatus.UNAVAILABLE, fetchedAt };
    }
  }

  /**
   * Map tiles + layout for a `width` × `height` route overview (drawn by the PDF service), or
   * null if tiles are switched off or any tile fails. A partial map would be misleading.
   */
  async routeMap(
    points: MapPoint[],
    width: number,
    height: number,
  ): Promise<RouteMap | null> {
    if (!this.tiles.configured || !points.length) return null;
    const plan = planRouteMap(points, width, height);
    if (plan.tiles.length > MAX_MAP_TILES) return null;
    try {
      const tiles = await Promise.all(
        plan.tiles.map(async (t) => ({
          ...t,
          image: await this.tiles.getTile(t.z, t.x, t.y),
        })),
      );
      return { plan, tiles, attribution: this.tiles.attribution };
    } catch (err) {
      this.logger.warn(`Map tiles failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * The line through the points in order, for the trip map. Follows roads where it can: one
   * request for the whole route; if some stops can't be joined by road, leg by leg, with a
   * straight line for each leg that has none. Never throws.
   */
  async routeThrough(points: RoutePoint[]): Promise<TripRoute> {
    if (points.length < 2) return this.straightRoute(points, RouteStatus.OK);
    if (!this.routing.configured) return this.straightRoute(points, RouteStatus.NOT_CONFIGURED);
    try {
      const road = await this.routing.route(points);
      return this.assemble(
        RouteStatus.OK,
        road.coordinates,
        road.legs.map((l) => ({ ...l, routed: true })),
      );
    } catch (err) {
      if (!(err instanceof NoRoadRouteError)) {
        this.logger.warn(`Routing failed for ${points.length} stops: ${(err as Error).message}`);
        return this.straightRoute(points, RouteStatus.UNAVAILABLE);
      }
    }

    const coordinates: [number, number][] = [];
    const legs: RouteLeg[] = [];
    let failed = false;
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      let line: [number, number][];
      try {
        const road = await this.routing.route([a, b]);
        line = road.coordinates;
        legs.push({ distanceMeters: road.distanceMeters, durationSeconds: road.durationSeconds, routed: true });
      } catch (err) {
        if (!(err instanceof NoRoadRouteError)) {
          failed = true;
          this.logger.warn(`Routing failed for one leg: ${(err as Error).message}`);
        }
        line = [[a.lng, a.lat], [b.lng, b.lat]];
        legs.push(straightLeg(a, b));
      }
      coordinates.push(...(coordinates.length ? line.slice(1) : line)); // legs share their end points
    }
    return this.assemble(failed ? RouteStatus.UNAVAILABLE : RouteStatus.PARTIAL, coordinates, legs);
  }

  /**
   * Road route between two points (member routes on the Journey map). Unlike routeThrough there
   * is never a straight-line stand-in: without a real road route, `geometry` and the numbers are
   * null. Not cached here: RoutesService caches the answers in Redis. Never throws.
   */
  async roadBetween(a: RoutePoint, b: RoutePoint): Promise<RoadBetween> {
    const empty = (status: RoadStatus): RoadBetween => ({
      status,
      profile: this.routingProfile,
      geometry: null,
      distanceMeters: null,
      durationSeconds: null,
      attribution: this.routing.attribution,
      computedAt: new Date().toISOString(),
    });
    if (!this.routing.configured) return empty(RoadStatus.NOT_CONFIGURED);

    let value: RoadBetween;
    try {
      const road = await this.routing.route([a, b]);
      value = {
        ...empty(RoadStatus.OK),
        geometry: { type: 'LineString', coordinates: road.coordinates },
        distanceMeters: Math.round(road.distanceMeters),
        durationSeconds: Number.isFinite(road.durationSeconds) ? Math.round(road.durationSeconds) : null,
      };
    } catch (err) {
      if (!(err instanceof NoRoadRouteError)) {
        this.logger.warn(`Routing failed between two points: ${(err as Error).message}`);
        return empty(RoadStatus.UNAVAILABLE);
      }
      value = empty(RoadStatus.NO_ROUTE);
    }
    return value;
  }

  private straightRoute(points: RoutePoint[], status: RouteStatus): TripRoute {
    const legs = points.slice(1).map((b, i) => straightLeg(points[i], b));
    return this.assemble(status, points.map((p) => [p.lng, p.lat]), legs);
  }

  private assemble(status: RouteStatus, coordinates: [number, number][], legs: RouteLeg[]): TripRoute {
    const total = (pick: (l: RouteLeg) => number) => Math.round(legs.reduce((sum, l) => sum + pick(l), 0));
    return {
      status,
      profile: this.routingProfile,
      distanceMeters: total((l) => l.distanceMeters),
      durationSeconds: legs.every((l) => l.routed) ? total((l) => l.durationSeconds ?? 0) : null,
      geometry: { type: 'LineString', coordinates },
      legs: legs.map((l) => ({
        ...l,
        distanceMeters: Math.round(l.distanceMeters),
        durationSeconds: l.durationSeconds === null ? null : Math.round(l.durationSeconds),
      })),
      attribution: this.routing.attribution,
      computedAt: new Date().toISOString(),
    };
  }
}

function straightLeg(a: RoutePoint, b: RoutePoint): RouteLeg {
  return { distanceMeters: distanceMeters(a.lat, a.lng, b.lat, b.lng), durationSeconds: null, routed: false };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
