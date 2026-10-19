import { Injectable } from '@nestjs/common';
import { fetchWithTimeout } from './http.js';

export interface DailyForecast {
  date: string; // YYYY-MM-DD, local to the location
  summary: string; // e.g. "light rain"
  tempMinC: number;
  tempMaxC: number;
  /** Null when the provider has no precipitation probability for that place and day. */
  precipitationChancePercent: number | null;
  windSpeedKph: number; // strongest forecast wind of the day
}

/** Daily weather forecast. Abstract so the vendor can be swapped (and faked in tests). */
export abstract class WeatherProvider {
  abstract readonly configured: boolean;
  abstract readonly name: string;
  /** Credit line the data licence requires wherever forecasts are shown (app, PDF). */
  abstract readonly attribution: string;
  /** How many days ahead (including today) the provider forecasts. */
  abstract readonly forecastDays: number;
  abstract getDailyForecast(lat: number, lng: number): Promise<DailyForecast[]>;
}

interface MetPeriod {
  summary?: { symbol_code?: string };
  details?: {
    air_temperature_min?: number;
    air_temperature_max?: number;
    probability_of_precipitation?: number;
  };
}

interface MetResponse {
  properties: {
    timeseries: {
      time: string; // UTC, e.g. 2026-10-10T06:00:00Z
      data: {
        instant: { details: { air_temperature?: number; wind_speed?: number } };
        next_1_hours?: MetPeriod;
        next_6_hours?: MetPeriod;
        next_12_hours?: MetPeriod;
      };
    }[];
  };
}

const CACHE_FALLBACK_MS = 30 * 60_000;
const CACHE_MAX_ENTRIES = 1000;

/**
 * MET Norway Locationforecast 2.0 ("complete"), from the Norwegian Meteorological Institute.
 * Free with global coverage, commercial use allowed, no key. Their terms: an identifying
 * User-Agent (sent by fetchWithTimeout), at most 4 decimals in coordinates, cache responses
 * until their Expires header, and credit "MET Norway" (CC BY 4.0) where the data is shown.
 *
 * The API returns hourly / 6-hourly UTC steps for ~9 days; this rolls them up into local days.
 * MET gives no time zone, so "local" is solar time from the longitude (lng / 15 hours). That
 * can be up to ~2 hours off civil time, which only shifts which night the day's minimum
 * temperature comes from.
 */
@Injectable()
export class MetNorwayWeatherProvider extends WeatherProvider {
  readonly configured = true;
  readonly name = 'met-norway';
  readonly attribution = 'Weather data: MET Norway';
  readonly forecastDays = 9;
  private readonly cache = new Map<
    string,
    { expires: number; days: DailyForecast[] }
  >();

  async getDailyForecast(lat: number, lng: number): Promise<DailyForecast[]> {
    // MET rejects more than 4 decimals; ~11 m precision is plenty for a forecast.
    const la = Number(lat.toFixed(4));
    const lo = Number(lng.toFixed(4));
    const key = `${la},${lo}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.days;

    const res = await fetchWithTimeout(
      `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${la}&lon=${lo}`,
    );
    const days = toDailyForecasts((await res.json()) as MetResponse, lo);
    const expires = Date.parse(res.headers.get('expires') ?? '');
    this.remember(
      key,
      Number.isNaN(expires) ? Date.now() + CACHE_FALLBACK_MS : expires,
      days,
    );
    return days;
  }

  private remember(key: string, expires: number, days: DailyForecast[]): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.cache)
        if (v.expires <= now) this.cache.delete(k);
      // Still full: drop the oldest entry (Map keeps insertion order).
      if (this.cache.size >= CACHE_MAX_ENTRIES)
        this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, { expires, days });
  }
}

/** Rolls MET's time steps up into one forecast per local (solar) day. Exported for tests. */
export function toDailyForecasts(
  body: MetResponse,
  lng: number,
): DailyForecast[] {
  const offsetMs = (lng / 15) * 3_600_000;
  const byDay = new Map<
    string,
    {
      temps: number[];
      winds: number[];
      chances: number[];
      symbols: { hour: number; code: string }[];
      coveredUntil: number;
    }
  >();

  for (const step of body.properties.timeseries) {
    const local = new Date(Date.parse(step.time) + offsetMs);
    const date = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    let day = byDay.get(date);
    if (!day)
      byDay.set(
        date,
        (day = {
          temps: [],
          winds: [],
          chances: [],
          symbols: [],
          coveredUntil: 0,
        }),
      );

    const {
      instant,
      next_1_hours: h1,
      next_6_hours: h6,
      next_12_hours: h12,
    } = step.data;
    if (instant.details.air_temperature !== undefined)
      day.temps.push(instant.details.air_temperature);
    if (instant.details.wind_speed !== undefined)
      day.winds.push(instant.details.wind_speed);
    if (h6?.details?.air_temperature_min !== undefined)
      day.temps.push(h6.details.air_temperature_min);
    if (h6?.details?.air_temperature_max !== undefined)
      day.temps.push(h6.details.air_temperature_max);
    for (const p of [h1, h6, h12]) {
      if (p?.details?.probability_of_precipitation !== undefined)
        day.chances.push(p.details.probability_of_precipitation);
    }
    // Daytime summary: prefer 6-hour symbols, then 1-hour ones.
    const symbol = h6?.summary?.symbol_code ?? h1?.summary?.symbol_code;
    if (symbol) day.symbols.push({ hour, code: symbol });
    day.coveredUntil = Math.max(day.coveredUntil, hour + (h6 ? 6 : h1 ? 1 : 0));
  }

  const dates = [...byDay.keys()];
  return dates.flatMap((date, i) => {
    const day = byDay.get(date)!;
    // Skip a trailing day the forecast only covers in part (its min/max would be misleading).
    // The first day is partial too, but that's just "the rest of today".
    if (i > 0 && day.coveredUntil < 18) return [];
    if (!day.temps.length) return [];
    // The symbol closest to midday describes the day best.
    const symbol = day.symbols.sort(
      (a, b) => Math.abs(a.hour - 12) - Math.abs(b.hour - 12),
    )[0]?.code;
    return [
      {
        date,
        summary: symbol ? describeSymbol(symbol) : 'unknown',
        tempMinC: Math.round(Math.min(...day.temps)),
        tempMaxC: Math.round(Math.max(...day.temps)),
        precipitationChancePercent: day.chances.length
          ? Math.round(Math.max(...day.chances))
          : null,
        windSpeedKph: day.winds.length
          ? Math.round(Math.max(...day.winds) * 3.6)
          : 0,
      },
    ];
  });
}

const SYMBOL_WORDS = [
  'clear',
  'sky',
  'fair',
  'partly',
  'cloudy',
  'fog',
  'light',
  'heavy',
  'rain',
  'sleet',
  'snow',
  'showers',
  'and',
  'thunder',
];

/** "lightrainshowers_day" → "light rain showers". Unknown codes are returned as-is. */
export function describeSymbol(code: string): string {
  // MET spells two codes "lightssleet…" / "lightssnow…"; normalise them first.
  let rest = code
    .replace(/_(day|night|polartwilight)$/, '')
    .replace(/^lights(?=sleet|snow)/, 'light');
  const words: string[] = [];
  while (rest) {
    const word = SYMBOL_WORDS.find((w) => rest.startsWith(w));
    if (!word) return code;
    words.push(word);
    rest = rest.slice(word.length);
  }
  return words.join(' ');
}
