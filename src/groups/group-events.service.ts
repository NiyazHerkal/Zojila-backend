import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupMember, GroupRole } from '../database/entities/index.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Socket event when the trip itself changes (details, dates, cover image, closed/reopened). */
export const GROUP_EVENTS = {
  UPDATED: 'group:updated',
} as const;

/** Socket events about membership (change request v1.0, change 5). */
export const MEMBER_EVENTS = {
  JOINED: 'member:joined',
  REMOVED: 'member:removed',
  ROLE_CHANGED: 'member:role_changed',
} as const;

// Same event the location module sends; named here to avoid a module cycle.
const LOCATION_SHARING_STOPPED = 'location:sharing-stopped';

/** How someone joined: added by an admin, an email/SMS invite, or the share link. */
export type JoinedVia = 'DIRECT' | 'INVITE' | 'LINK';

export function memberView(member: GroupMember) {
  return {
    userId: member.userId,
    username: member.user.username,
    name: member.user.name,
    avatarUrl: member.user.avatarUrl,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}

/**
 * Tells the group's apps when the member list changes, so it stays current without a reload.
 * Call after the change is committed. `null` actor = done by the system (e.g. the automatic
 * admin hand-over when an admin deletes their account).
 */
@Injectable()
export class GroupEventsService {
  constructor(
    private readonly realtime: RealtimeService,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
  ) {}

  async memberJoined(groupId: string, userId: string, via: JoinedVia, addedBy: string | null): Promise<void> {
    const member = await this.members.findOne({ where: { groupId, userId }, relations: { user: true } });
    if (!member) return;
    await this.realtime.emitToGroup(groupId, MEMBER_EVENTS.JOINED, {
      groupId,
      member: memberView(member),
      via,
      addedBy,
      timestamp: new Date(),
    });
  }

  /**
   * Goes to the remaining members and to the person removed (their app drops the trip). If they
   * were sharing their location (the share row went with the membership), the group also gets
   * `location:sharing-stopped` so their pin disappears.
   */
  async memberRemoved(groupId: string, userId: string, removedBy: string | null, wasSharing = false): Promise<void> {
    const payload = { groupId, userId, removedBy, left: removedBy === userId, timestamp: new Date() };
    await this.realtime.emitToGroup(groupId, MEMBER_EVENTS.REMOVED, payload, { exceptUserId: userId });
    await this.realtime.emitToUser(userId, MEMBER_EVENTS.REMOVED, payload);
    if (wasSharing) {
      await this.realtime.emitToGroup(groupId, LOCATION_SHARING_STOPPED, { groupId, userId, reason: 'REMOVED' });
    }
  }

  /**
   * `group` is the group object without `myRole` (that differs per member; it doesn't change
   * here). Apps replace their copy of the trip with it.
   */
  async groupUpdated(groupId: string, group: object, changedBy: string): Promise<void> {
    await this.realtime.emitToGroup(groupId, GROUP_EVENTS.UPDATED, { groupId, group, changedBy, timestamp: new Date() });
  }

  async roleChanged(groupId: string, userId: string, newRole: GroupRole, changedBy: string | null): Promise<void> {
    await this.realtime.emitToGroup(groupId, MEMBER_EVENTS.ROLE_CHANGED, {
      groupId,
      userId,
      newRole,
      changedBy,
      timestamp: new Date(),
    });
  }
}
