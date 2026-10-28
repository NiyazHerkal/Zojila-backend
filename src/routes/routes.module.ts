import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { LocationModule } from '../location/location.module.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';

@Module({
  imports: [AuthModule, GroupsModule, EnrichmentModule, LocationModule],
  controllers: [RoutesController],
  providers: [RoutesService],
})
export class RoutesModule {}
