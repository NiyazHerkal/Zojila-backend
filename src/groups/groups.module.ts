import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Group, GroupMember, Invite, User } from '../database/entities/index.js';
import { InviteDeliveryService } from '../notifications/invite-delivery.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { GroupEventsService } from './group-events.service.js';
import { GroupAccessService } from './group-access.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { GroupMemberGuard } from './guards/group-member.guard.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

/**
 * Later group-scoped modules (itinerary, location, chat, expenses…) import this module and
 * AuthModule (for JwtAuthGuard), then use `@UseGuards(JwtAuthGuard, GroupMemberGuard)` +
 * `@GroupRoles(...)` on `:groupId` routes.
 */
@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    // RealtimeModule imports this module too (for the guard), hence forwardRef on both sides.
    forwardRef(() => RealtimeModule),
    TypeOrmModule.forFeature([Group, GroupMember, Invite, User]),
  ],
  controllers: [GroupsController, InvitesController],
  providers: [GroupsService, InvitesService, GroupAccessService, GroupMemberGuard, InviteDeliveryService, GroupEventsService],
  // GroupsService: the offline bundle; GroupEventsService: account deletion
  exports: [GroupAccessService, GroupMemberGuard, GroupsService, GroupEventsService],
})
export class GroupsModule {}
