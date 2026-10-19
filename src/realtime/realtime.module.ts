import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { GroupMember, User } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';
import { SocketServerRef } from './socket-server.ref.js';

@Module({
  imports: [JwtModule.register({}), AuthModule, forwardRef(() => GroupsModule), TypeOrmModule.forFeature([GroupMember, User])],
  controllers: [PresenceController],
  providers: [SocketServerRef, RealtimeGateway, RealtimeService, PresenceService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
