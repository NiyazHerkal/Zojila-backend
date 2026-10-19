import { Module } from '@nestjs/common';
import {
  ElevationProvider,
  OpenMeteoElevationProvider,
} from './elevation.provider.js';
import { EnrichmentService } from './enrichment.service.js';
import {
  MapTileProvider,
  UrlTemplateTileProvider,
} from './map-tile.provider.js';
import { OsrmRoutingProvider, RoutingProvider } from './routing.provider.js';
import {
  MetNorwayWeatherProvider,
  WeatherProvider,
} from './weather.provider.js';

/**
 * Third-party enrichment. Vendors are bound here, so switching one (e.g. a different weather
 * API once the lead confirms) means binding another subclass, with no changes elsewhere.
 * Open stack, no keys needed: OpenStreetMap tiles (MAP_TILE_URL), Open-Meteo elevation,
 * MET Norway weather and OSRM road routes (ROUTING_URL).
 */
@Module({
  providers: [
    EnrichmentService,
    { provide: ElevationProvider, useClass: OpenMeteoElevationProvider },
    { provide: WeatherProvider, useClass: MetNorwayWeatherProvider },
    { provide: MapTileProvider, useClass: UrlTemplateTileProvider },
    { provide: RoutingProvider, useClass: OsrmRoutingProvider },
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
