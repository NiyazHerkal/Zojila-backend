import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceToken, Group, GroupMember, Notification, User } from '../database/entities/index.js';
import { DevicesController, DevicesService } from './devices.controller.js';
import { NotificationFeedService } from './notification-feed.service.js';
import { NotificationsController } from './notifications.controller.js';
import { PushService } from './push.service.js';

/**
 * Push notifications (FCM) + device registration, and the notifications feed. Push is used by
 * location expiry, chat, alerts/SOS, NEED_HELP status and expenses; alert, trip and expense pushes
 * also land in the feed, as do trip events without a push (NotificationFeedService.recordTripEvent).
 */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([DeviceToken, Group, GroupMember, Notification, User])],
  controllers: [DevicesController, NotificationsController],
  providers: [PushService, DevicesService, NotificationFeedService],
  exports: [PushService, NotificationFeedService],
})
export class NotificationsModule {}
