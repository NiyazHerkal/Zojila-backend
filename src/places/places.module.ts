import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GeocodingProvider, NominatimGeocodingProvider } from './geocoding.provider.js';
import { PlaceSearchController } from './place-search.controller.js';
import { PlaceSearchService } from './place-search.service.js';
import { PlacesController } from './places.controller.js';
import { OverpassPlacesProvider, PlacesProvider } from './places.provider.js';
import { PlacesService } from './places.service.js';

/**
 * Nearby places (change request v1.0, change 1) and place search by name (backend handover
 * 2026-10-22). Swap a source by binding another PlacesProvider / GeocodingProvider.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlacesController, PlaceSearchController],
  providers: [
    PlacesService,
    PlaceSearchService,
    { provide: PlacesProvider, useClass: OverpassPlacesProvider },
    { provide: GeocodingProvider, useClass: NominatimGeocodingProvider },
  ],
})
export class PlacesModule {}
