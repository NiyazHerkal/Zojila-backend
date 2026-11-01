import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { GroupMember, LocationHistoryPoint, LocationShare, LocationShareLink } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StatusModule } from '../status/status.module.js';
import { LocationController } from './location.controller.js';
import { MeLocationController } from './me-location.controller.js';
import { LiveShareController, PublicLiveShareController } from './live-share.controller.js';
import { LiveShareGateway } from './live-share.gateway.js';
import { LiveNamespaceRef, LiveShareService } from './live-share.service.js';
import { LocationHistoryService } from './location-history.service.js';
import { LocationService } from './location.service.js';

@Module({
  imports: [
    AuthModule,
    GroupsModule,
    RealtimeModule,
    NotificationsModule,
    StatusModule,
    TypeOrmModule.forFeature([LocationShare, LocationShareLink, GroupMember, LocationHistoryPoint]),
  ],
  controllers: [LocationController, MeLocationController, LiveShareController, PublicLiveShareController],
  providers: [LocationService, LocationHistoryService, LiveShareService, LiveNamespaceRef, LiveShareGateway],
  exports: [LocationService, LiveShareService], // LiveShareService: account deletion
})
export class LocationModule {}
