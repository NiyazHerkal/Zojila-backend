import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Group, GroupMember, Message, MessageAck, MessageRead } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { LocationModule } from '../location/location.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';
import { MessagesController } from './messages.controller.js';

/** Phase 8 (PDF §2.5): group chat, alerts and SOS. */
@Module({
  imports: [
    AuthModule,
    GroupsModule,
    RealtimeModule,
    NotificationsModule,
    LocationModule,
    TypeOrmModule.forFeature([Message, MessageAck, MessageRead, GroupMember, Group]),
  ],
  controllers: [MessagesController, AlertsController],
  providers: [ChatGateway, ChatService, AlertsService],
  exports: [ChatService, AlertsService], // the offline bundle includes recent chat + active alerts
})
export class ChatModule {}
