import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceToken } from '../database/entities/index.js';
import { DevicesController, DevicesService } from './devices.controller.js';
import { PushService } from './push.service.js';

/** Push notifications (FCM) + device registration. Used by location expiry, chat, alerts/SOS and NEED_HELP status. */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([DeviceToken])],
  controllers: [DevicesController],
  providers: [PushService, DevicesService],
  exports: [PushService],
})
export class NotificationsModule {}
