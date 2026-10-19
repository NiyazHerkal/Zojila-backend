import { ConfigService } from '@nestjs/config';
import { AltitudeZone, altitudeContext } from './altitude.js';
import {
  ElevationProvider,
  OpenMeteoElevationProvider,
} from './elevation.provider.js';
import { EnrichmentService, RouteStatus, WeatherStatus } from './enrichment.service.js';
import {
  MapTileProvider,
  UrlTemplateTileProvider,
} from './map-tile.provider.js';
import { planRouteMap } from './route-map.js';
import { NoRoadRouteError, OsrmRoutingProvider, RoutingProvider, type RoutePoint } from './routing.provider.js';
import {
  MetNorwayWeatherProvider,
  WeatherProvider,
  describeSymbol,
  toDailyForecasts,
  type DailyForecast,
} from './weather.provider.js';

const isoDay = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const config = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

describe('altitudeContext', () => {
  it('reports sea level as full oxygen', () => {
    expect(altitudeContext(0)).toEqual({
      meters: 0,
      oxygenPercentOfSeaLevel: 100,
      effectiveOxygenPercent: 20.9,
      zone: AltitudeZone.LOW,
    });
  });

  it('matches known values at Leh (~3,500 m) and Khardung La (~5,359 m)', () => {
    expect(altitudeContext(3500)).toMatchObject({
      oxygenPercentOfSeaLevel: 65,
      zone: AltitudeZone.VERY_HIGH,
    });
    expect(altitudeContext(5359)).toMatchObject({
      oxygenPercentOfSeaLevel: 51,
      zone: AltitudeZone.VERY_HIGH,
    });
    expect(altitudeContext(2050).zone).toBe(AltitudeZone.HIGH);
    expect(altitudeContext(6000).zone).toBe(AltitudeZone.EXTREME);
  });
});

describe('EnrichmentService', () => {
  const forecast = (date: string): DailyForecast => ({
    date,
    summary: 'clear sky',
    tempMinC: 2,
    tempMaxC: 14,
    precipitationChancePercent: 10,
    windSpeedKph: 12,
  });

  function build(opts: { configured: boolean; weatherFails?: boolean }) {
    const weather: WeatherProvider = {
      configured: opts.configured,
      name: 'fake',
      attribution: 'Weather: test',
      forecastDays: 8,
      getDailyForecast: vi.fn(async () => {
        if (opts.weatherFails) throw new Error('boom');
        return Array.from({ length: 8 }, (_, i) => forecast(isoDay(i)));
      }),
    };
    const elevation: ElevationProvider = {
      configured: opts.configured,
      getElevation: vi.fn(async () => 3500),
    };
    const tiles: MapTileProvider = {
      configured: opts.configured,
      attribution: '© test',
      getTile: vi.fn(async () => Buffer.from('png')),
    };
    const routing: RoutingProvider = {
      configured: opts.configured,
      profile: 'driving',
      attribution: 'Routes: test',
      route: vi.fn(async () => {
        throw new Error('not used here');
      }),
    };
    return {
      service: new EnrichmentService(elevation, weather, tiles, routing),
      weather,
      elevation,
      tiles,
    };
  }

  it('reports NOT_CONFIGURED and makes no calls without keys', async () => {
    const { service, weather, elevation } = build({ configured: false });
    expect(await service.elevationFor(1, 2)).toBeNull();
    expect((await service.weatherFor(1, 2, isoDay(1))).status).toBe(
      WeatherStatus.NOT_CONFIGURED,
    );
    expect(await service.routeMap([{ lat: 1, lng: 2 }], 495, 300)).toBeNull();
    expect(weather.getDailyForecast).not.toHaveBeenCalled();
    expect(elevation.getElevation).not.toHaveBeenCalled();
  });

  it('returns the forecast for a date inside the window', async () => {
    const { service } = build({ configured: true });
    const result = await service.weatherFor(1, 2, isoDay(3));
    expect(result).toMatchObject({
      status: WeatherStatus.OK,
      forecast: { date: isoDay(3), provider: 'fake' },
    });
  });

  it('skips the API for missing, far-future and past dates', async () => {
    const { service, weather } = build({ configured: true });
    expect((await service.weatherFor(1, 2, null)).status).toBe(
      WeatherStatus.NO_DATE,
    );
    expect(await service.weatherFor(1, 2, isoDay(30))).toMatchObject({
      status: WeatherStatus.NOT_YET_AVAILABLE,
      availableFrom: isoDay(23),
    });
    expect((await service.weatherFor(1, 2, isoDay(-10))).status).toBe(
      WeatherStatus.PAST_DATE,
    );
    expect(weather.getDailyForecast).not.toHaveBeenCalled();
  });

  it('fetches every tile the route map needs', async () => {
    const { service, tiles } = build({ configured: true });
    const map = await service.routeMap(
      [
        { lat: 32.24, lng: 77.19 },
        { lat: 34.15, lng: 77.58 },
      ],
      495,
      300,
    );
    expect(map?.tiles.length).toBeGreaterThan(0);
    expect(tiles.getTile).toHaveBeenCalledTimes(map!.tiles.length);
    expect(map?.attribution).toBe('© test');
  });

  it('degrades to UNAVAILABLE when the provider fails', async () => {
    const { service } = build({ configured: true, weatherFails: true });
    expect((await service.weatherFor(1, 2, isoDay(1))).status).toBe(
      WeatherStatus.UNAVAILABLE,
    );
  });
});

describe('vendor adapters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('open providers need no key', () => {
    expect(new MetNorwayWeatherProvider().configured).toBe(true);
    expect(new OpenMeteoElevationProvider(config({})).configured).toBe(true);
    expect(new UrlTemplateTileProvider(config({})).configured).toBe(true);
    expect(
      new UrlTemplateTileProvider(config({ MAP_TILE_URL: 'off' })).configured,
    ).toBe(false);
  });

  it('parses the Open-Meteo elevation response (free and commercial endpoints)', async () => {
    const fetchMock = vi.fn(async () => Response.json({ elevation: [3524.0] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await new OpenMeteoElevationProvider(config({})).getElevation(
        34.16,
        77.58,
      ),
    ).toBe(3524);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(
      /^https:\/\/api\.open-meteo\.com\/v1\/elevation\?latitude=34\.16&longitude=77\.58$/,
    );

    await new OpenMeteoElevationProvider(
      config({ OPEN_METEO_API_KEY: 'k' }),
    ).getElevation(1, 2);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toMatch(
      /customer-api\.open-meteo\.com.*apikey=k/,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: true, reason: 'Latitude must be in range' }),
      ),
    );
    await expect(
      new OpenMeteoElevationProvider(config({})).getElevation(99, 2),
    ).rejects.toThrow(/Latitude/);
  });

  it('builds OSM tile URLs from the template and sends a User-Agent', async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from('tile')));
    vi.stubGlobal('fetch', fetchMock);
    await new UrlTemplateTileProvider(config({})).getTile(7, 91, 52);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://tile.openstreetmap.org/7/91/52.png');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(
      /TravelGo/,
    );
  });

  // Leh (77.58° E): solar offset ≈ +5h10m, so 18:00 UTC is already the next local day.
  const metStep = (
    time: string,
    temp: number,
    wind: number,
    h6?: Record<string, unknown>,
    h1?: Record<string, unknown>,
  ) => ({
    time,
    data: {
      instant: { details: { air_temperature: temp, wind_speed: wind } },
      ...(h1 && { next_1_hours: h1 }),
      ...(h6 && { next_6_hours: h6 }),
    },
  });
  const metBody = {
    properties: {
      timeseries: [
        metStep('2026-10-10T00:00:00Z', 1.6, 2, {
          summary: { symbol_code: 'clearsky_day' },
          details: {
            air_temperature_min: 1.2,
            air_temperature_max: 9.8,
            probability_of_precipitation: 5,
          },
        }),
        metStep('2026-10-10T06:00:00Z', 12, 5, {
          summary: { symbol_code: 'lightsnowshowers_day' },
          details: {
            air_temperature_min: 9.9,
            air_temperature_max: 13.4,
            probability_of_precipitation: 35,
          },
        }),
        metStep('2026-10-10T12:00:00Z', 7, 3, {
          summary: { symbol_code: 'cloudy' },
          details: {
            air_temperature_min: 4,
            air_temperature_max: 11,
            probability_of_precipitation: 20,
          },
        }),
        // 18:00 UTC = 23:10 local on the 10th; 00:00 UTC on the 11th = 05:10 local.
        metStep('2026-10-10T18:00:00Z', 3, 1, {
          summary: { symbol_code: 'fair_night' },
          details: { air_temperature_min: 0.4, air_temperature_max: 3 },
        }),
        // The 11th: only one 6-hour block (05:10–11:10 local), so it's dropped as partial.
        metStep('2026-10-11T00:00:00Z', 0, 1, {
          summary: { symbol_code: 'fog' },
          details: {},
        }),
      ],
    },
  };

  it('rolls MET Norway steps up into local days with metric units', () => {
    expect(toDailyForecasts(metBody, 77.5771)).toEqual([
      {
        date: '2026-10-10',
        summary: 'light snow showers',
        tempMinC: 0,
        tempMaxC: 13,
        precipitationChancePercent: 35,
        windSpeedKph: 18,
      },
    ]);
  });

  it('reports a null rain chance when MET has no probability for the day', () => {
    const body = {
      properties: {
        timeseries: [
          metStep('2026-10-10T00:00:00Z', 5, 2, undefined, {
            summary: { symbol_code: 'rain' },
            details: {},
          }),
          metStep('2026-10-10T12:00:00Z', 8, 2, {
            summary: { symbol_code: 'rain' },
            details: {},
          }),
        ],
      },
    };
    expect(toDailyForecasts(body, 0)[0]).toMatchObject({
      summary: 'rain',
      precipitationChancePercent: null,
    });
  });

  it('turns MET symbol codes into words', () => {
    expect(describeSymbol('clearsky_polartwilight')).toBe('clear sky');
    expect(describeSymbol('partlycloudy_night')).toBe('partly cloudy');
    expect(describeSymbol('heavyrainshowersandthunder_day')).toBe(
      'heavy rain showers and thunder',
    );
    expect(describeSymbol('lightssleetshowersandthunder_day')).toBe(
      'light sleet showers and thunder',
    );
    expect(describeSymbol('lightsleet')).toBe('light sleet');
    expect(describeSymbol('somethingnew')).toBe('somethingnew');
  });

  it('calls MET Norway with 4-decimal coordinates and caches until Expires', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(metBody), {
          headers: { expires: new Date(Date.now() + 60_000).toUTCString() },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MetNorwayWeatherProvider();
    const first = await provider.getDailyForecast(34.152612, 77.577149);
    expect(await provider.getDailyForecast(34.152612, 77.577149)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=34.1526&lon=77.5771',
    );
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(
      /TravelGo/,
    );
  });
});

describe('planRouteMap', () => {
  const manali = { lat: 32.2432, lng: 77.1892 };
  const leh = { lat: 34.1526, lng: 77.5771 };

  it('keeps every point inside the box with padding', () => {
    const plan = planRouteMap([manali, leh], 495, 300);
    for (const p of [manali, leh]) {
      const { x, y } = plan.project(p);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(495);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(300);
    }
    expect(plan.zoom).toBeGreaterThanOrEqual(6);
    expect(plan.zoom).toBeLessThanOrEqual(9);
  });

  it('covers the whole box with tiles', () => {
    const plan = planRouteMap([manali, leh], 495, 300);
    const minLeft = Math.min(...plan.tiles.map((t) => t.left));
    const maxRight = Math.max(...plan.tiles.map((t) => t.left + t.size));
    const minTop = Math.min(...plan.tiles.map((t) => t.top));
    const maxBottom = Math.max(...plan.tiles.map((t) => t.top + t.size));
    expect(minLeft).toBeLessThanOrEqual(0);
    expect(maxRight).toBeGreaterThanOrEqual(495);
    expect(minTop).toBeLessThanOrEqual(0);
    expect(maxBottom).toBeGreaterThanOrEqual(300);
  });

  it('uses a street-level zoom for a single point, centred', () => {
    const plan = planRouteMap([manali], 495, 300);
    expect(plan.zoom).toBe(12);
    const { x, y } = plan.project(manali);
    expect(x).toBeCloseTo(247.5, 5);
    expect(y).toBeCloseTo(150, 5);
  });
});

describe('EnrichmentService.routeThrough', () => {
  const manali = { lat: 32.2432, lng: 77.1892 };
  const keylong = { lat: 32.5715, lng: 77.0326 };
  const leh = { lat: 34.1526, lng: 77.5771 };
  const noop = { configured: false } as never;

  // Fake road: a midpoint between each pair, 1.5× the straight distance, 60 km/h.
  function fakeRoad(points: RoutePoint[]) {
    const coordinates: [number, number][] = [[points[0].lng, points[0].lat]];
    const legs = points.slice(1).map((b, i) => {
      const a = points[i];
      coordinates.push([(a.lng + b.lng) / 2, (a.lat + b.lat) / 2], [b.lng, b.lat]);
      return { distanceMeters: 1000, durationSeconds: 60 };
    });
    return { distanceMeters: legs.length * 1000, durationSeconds: legs.length * 60, coordinates, legs };
  }

  function build(route: (points: RoutePoint[]) => Promise<ReturnType<typeof fakeRoad>>, configured = true) {
    const routing: RoutingProvider = { configured, profile: 'driving', attribution: 'Routes: test', route: vi.fn(route) };
    return { service: new EnrichmentService(noop, noop, noop, routing), routing };
  }

  it('follows roads through every stop with one request', async () => {
    const { service, routing } = build(async (pts) => fakeRoad(pts));
    const route = await service.routeThrough([manali, keylong, leh]);
    expect(route.status).toBe(RouteStatus.OK);
    expect(routing.route).toHaveBeenCalledTimes(1);
    expect(route.geometry.coordinates).toHaveLength(5);
    expect(route.legs).toEqual([
      { distanceMeters: 1000, durationSeconds: 60, routed: true },
      { distanceMeters: 1000, durationSeconds: 60, routed: true },
    ]);
    expect(route).toMatchObject({ distanceMeters: 2000, durationSeconds: 120, profile: 'driving' });
  });

  it('draws a straight line only for the legs with no road', async () => {
    const { service, routing } = build(async (pts) => {
      if (pts.length > 2 || pts[1] === leh) throw new NoRoadRouteError('no road');
      return fakeRoad(pts);
    });
    const route = await service.routeThrough([manali, keylong, leh]);
    expect(route.status).toBe(RouteStatus.PARTIAL);
    expect(routing.route).toHaveBeenCalledTimes(3); // whole route, then each leg
    expect(route.legs[0].routed).toBe(true);
    expect(route.legs[1]).toMatchObject({ routed: false, durationSeconds: null });
    expect(Math.round(route.legs[1].distanceMeters / 1000)).toBe(183); // Keylong → Leh, straight
    expect(route.durationSeconds).toBeNull();
    // Manali, midpoint, Keylong (shared, not repeated), Leh
    expect(route.geometry.coordinates).toEqual([
      [manali.lng, manali.lat],
      [(manali.lng + keylong.lng) / 2, (manali.lat + keylong.lat) / 2],
      [keylong.lng, keylong.lat],
      [leh.lng, leh.lat],
    ]);
  });

  it('falls back to straight lines when the provider fails', async () => {
    const { service } = build(async () => {
      throw new Error('timeout');
    });
    const route = await service.routeThrough([manali, leh]);
    expect(route.status).toBe(RouteStatus.UNAVAILABLE);
    expect(route.geometry.coordinates).toEqual([
      [manali.lng, manali.lat],
      [leh.lng, leh.lat],
    ]);
    expect(Math.round(route.distanceMeters / 1000)).toBe(215);
  });

  it('makes no calls when routing is off or there is nothing to join', async () => {
    const off = build(async (pts) => fakeRoad(pts), false);
    expect((await off.service.routeThrough([manali, leh])).status).toBe(RouteStatus.NOT_CONFIGURED);
    expect((await off.service.routeThrough([manali, leh])).profile).toBe('straight');
    const on = build(async (pts) => fakeRoad(pts));
    expect(await on.service.routeThrough([manali])).toMatchObject({ status: RouteStatus.OK, legs: [], distanceMeters: 0 });
    expect(off.routing.route).not.toHaveBeenCalled();
    expect(on.routing.route).not.toHaveBeenCalled();
  });
});

describe('OsrmRoutingProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks OSRM for the full GeoJSON route and reads the legs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              distance: 480000,
              duration: 36000,
              geometry: { type: 'LineString', coordinates: [[77.19, 32.24], [77.58, 34.15]] },
              legs: [{ distance: 480000, duration: 36000 }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const osrm = new OsrmRoutingProvider(config({ ROUTING_URL: 'https://osrm.example/' }));
    const road = await osrm.route([{ lat: 32.24, lng: 77.19 }, { lat: 34.15, lng: 77.58 }]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      'https://osrm.example/route/v1/driving/77.19,32.24;77.58,34.15?overview=full&geometries=geojson&steps=false',
    );
    expect(road).toEqual({
      distanceMeters: 480000,
      durationSeconds: 36000,
      coordinates: [[77.19, 32.24], [77.58, 34.15]],
      legs: [{ distanceMeters: 480000, durationSeconds: 36000 }],
    });
  });

  it('reports "no road" separately from a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"NoRoute"}', { status: 400 })));
    const osrm = new OsrmRoutingProvider(config({}));
    await expect(osrm.route([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).rejects.toBeInstanceOf(NoRoadRouteError);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    await expect(osrm.route([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).rejects.not.toBeInstanceOf(NoRoadRouteError);
  });

  it('can be switched off', () => {
    expect(new OsrmRoutingProvider(config({ ROUTING_URL: 'off' })).configured).toBe(false);
    expect(new OsrmRoutingProvider(config({})).configured).toBe(true);
  });
});
