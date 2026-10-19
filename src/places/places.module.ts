import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlacesController } from './places.controller.js';
import { OverpassPlacesProvider, PlacesProvider } from './places.provider.js';
import { PlacesService } from './places.service.js';

/** Nearby places (change request v1.0, change 1). Swap the source by binding another PlacesProvider. */
@Module({
  imports: [AuthModule],
  controllers: [PlacesController],
  providers: [PlacesService, { provide: PlacesProvider, useClass: OverpassPlacesProvider }],
})
export class PlacesModule {}
