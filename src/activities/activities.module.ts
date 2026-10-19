import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ActivityProgress, ActivityUpdate, Itinerary, Waypoint } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { ItineraryModule } from '../itinerary/itinerary.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ActivitiesController } from './activities.controller.js';
import { ActivitiesService } from './activities.service.js';

@Module({
  imports: [
    AuthModule,
    GroupsModule,
    ItineraryModule,
    RealtimeModule,
    TypeOrmModule.forFeature([ActivityProgress, ActivityUpdate, Itinerary, Waypoint]),
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
  exports: [ActivitiesService], // the offline bundle includes recent updates
})
export class ActivitiesModule {}
