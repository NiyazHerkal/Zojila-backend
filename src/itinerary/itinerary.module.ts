import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ActivityProgress, ActivityUpdate, Group, Itinerary, Waypoint } from '../database/entities/index.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ItineraryPdfService } from './itinerary-pdf.service.js';
import { ItineraryController } from './itinerary.controller.js';
import { ItineraryService } from './itinerary.service.js';

@Module({
  imports: [AuthModule, GroupsModule, EnrichmentModule, NotificationsModule, RealtimeModule, TypeOrmModule.forFeature([Itinerary, Waypoint, Group, ActivityProgress, ActivityUpdate])],
  controllers: [ItineraryController],
  providers: [ItineraryService, ItineraryPdfService],
  exports: [ItineraryService], // the offline bundle includes the itinerary
})
export class ItineraryModule {}
