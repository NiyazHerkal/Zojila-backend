import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Feedback, Group, Invite, LocationHistoryPoint, LocationShareLink, Notification, UsageDaily, User } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { LocationModule } from '../location/location.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { RetentionService } from './retention.service.js';

/** Phase 12 data privacy (PDF §4): data export, account deletion, retention job. */
@Module({
  imports: [
    AuthModule,
    GroupsModule,
    RealtimeModule,
    LocationModule,
    TypeOrmModule.forFeature([User, Group, Invite, UsageDaily, Feedback, LocationShareLink, Notification, LocationHistoryPoint]),
  ],
  controllers: [AccountController],
  providers: [AccountService, RetentionService],
  exports: [RetentionService],
})
export class PrivacyModule {}
