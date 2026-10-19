import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTimeout } from './http.js';

/** Raster map tiles (256 px, Web Mercator z/x/y) for the PDF route overview. Abstract so it can be swapped/faked. */
export abstract class MapTileProvider {
  abstract readonly configured: boolean;
  /** Credit line that must be printed with the map (tile licences require it). */
  abstract readonly attribution: string;
  /** PNG/JPEG bytes for one tile. Throws if the provider fails. */
  abstract getTile(z: number, x: number, y: number): Promise<Buffer>;
}

export const DEFAULT_TILE_URL =
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Any z/x/y tile server. Defaults to the public OpenStreetMap tiles, which are fine for
 * occasional PDF exports (their usage policy forbids heavy use). For production, set
 * MAP_TILE_URL to a hosted OSM tile provider (e.g. MapTiler, Stadia, Thunderforest; usually
 * with the key in the URL) and MAP_TILE_ATTRIBUTION to its credit line. Set MAP_TILE_URL=off
 * to drop the map from PDFs.
 */
@Injectable()
export class UrlTemplateTileProvider extends MapTileProvider {
  readonly attribution: string;
  private readonly template: string | null;

  constructor(config: ConfigService) {
    super();
    const url = config.get<string>('MAP_TILE_URL')?.trim();
    this.template = url === 'off' ? null : url || DEFAULT_TILE_URL;
    this.attribution =
      config.get<string>('MAP_TILE_ATTRIBUTION')?.trim() || DEFAULT_ATTRIBUTION;
  }

  get configured(): boolean {
    return this.template !== null;
  }

  async getTile(z: number, x: number, y: number): Promise<Buffer> {
    const url = this.template!.replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    return Buffer.from(await (await fetchWithTimeout(url)).arrayBuffer());
  }
}
