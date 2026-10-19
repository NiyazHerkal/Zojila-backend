import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Group, GroupMember, StatusUpdate } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StatusController } from './status.controller.js';
import { StatusService } from './status.service.js';

@Module({
  imports: [
    AuthModule,
    GroupsModule,
    RealtimeModule,
    NotificationsModule,
    TypeOrmModule.forFeature([StatusUpdate, GroupMember, Group]),
  ],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService], // the location map feed shows each member's trip status
})
export class StatusModule {}
