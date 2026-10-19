import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { apiKey, fetchWithTimeout } from './http.js';

/** Elevation lookup. Abstract so the vendor can be swapped (and faked in tests). */
export abstract class ElevationProvider {
  abstract readonly configured: boolean;
  /** Meters above sea level. Throws if the provider fails. */
  abstract getElevation(lat: number, lng: number): Promise<number>;
}

/**
 * Open-Meteo Elevation API (Copernicus 90 m terrain data). Needs no key. The free tier is
 * for non-commercial use; for production, buy an Open-Meteo plan and set OPEN_METEO_API_KEY,
 * which switches to their commercial endpoint. Chosen because the project uses open maps
 * (OpenStreetMap) rather than Google.
 */
@Injectable()
export class OpenMeteoElevationProvider extends ElevationProvider {
  readonly configured = true;
  private readonly key: string | null;

  constructor(config: ConfigService) {
    super();
    this.key = apiKey(config.get<string>('OPEN_METEO_API_KEY'));
  }

  async getElevation(lat: number, lng: number): Promise<number> {
    const url = this.key
      ? `https://customer-api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}&apikey=${this.key}`
      : `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
    const body = (await (await fetchWithTimeout(url)).json()) as {
      elevation?: number[];
      reason?: string;
    };
    const elevation = body.elevation?.[0];
    if (typeof elevation !== 'number' || Number.isNaN(elevation)) {
      throw new Error(
        `Open-Meteo elevation: ${body.reason ?? 'no elevation in response'}`,
      );
    }
    return elevation;
  }
}
