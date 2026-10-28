import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Group, GroupMember, Notification, User } from '../database/entities/index.js';

/** Push types that also go into the feed: alerts & SOS, trip changes, expenses (not chat or location sharing). */
export const FEED_PUSH_TYPES = new Set([
  'SOS',
  'CRITICAL_ALERT',
  'GENERAL_ALERT',
  'SOS_ACKNOWLEDGED',
  'SOS_RESOLVED',
  'STATUS_NEED_HELP',
  'GROUP_CLOSED',
  'EXPENSE_ADDED',
  'EXPENSE_SETTLEMENT',
]);

/** Feed-only types (no push is sent for these). */
export const TRIP_FEED_TYPES = {
  TRIP_INVITE: 'TRIP_INVITE',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  ITINERARY_UPDATED: 'ITINERARY_UPDATED',
} as const;

export const NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_LIMIT = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FeedEntry {
  type: string;
  title: string;
  body: string;
  /** Strings only, like push data. `groupId` here also files the entry under that trip. */
  data?: Record<string, string>;
}

export interface NotificationView {
  id: string;
  type: string;
  groupId: string | null;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * The notifications feed (backend handover 2026-10-22, Q2): what a user missed, readable in the
 * app's Notifications screen even without push. Entries come from feed-type pushes (PushService)
 * and from trip events that have no push. Recording is best-effort: it never fails the action
 * that caused it.
 */
@Injectable()
export class NotificationFeedService {
  private readonly logger = new Logger(NotificationFeedService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
  ) {}

  /** Adds the entry to each user's feed. Never throws. */
  async record(userIds: string[], entry: FeedEntry): Promise<void> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const data = entry.data ?? {};
    const groupId = data.groupId && UUID.test(data.groupId) ? data.groupId : null;
    try {
      await this.notifications.insert(
        unique.map((userId) => ({
          userId,
          groupId,
          type: entry.type.slice(0, 40),
          title: entry.title.slice(0, 200),
          body: entry.body.slice(0, 1000),
          data,
        })),
      );
    } catch (err) {
      this.logger.warn(`Could not record a ${entry.type} notification: ${(err as Error).message}`);
    }
  }

  /**
   * A trip event without a push. `build` gets the trip's name and the actor's name (null when
   * done by the system) and returns the title and body.
   */
  async recordTripEvent(
    userIds: string[],
    type: string,
    groupId: string,
    actorId: string | null,
    build: (trip: string, actor: string | null) => { title: string; body: string },
    data: Record<string, string> = {},
  ): Promise<void> {
    if (!userIds.length) return;
    try {
      const [group, actor] = await Promise.all([
        this.groups.findOne({ where: { id: groupId }, select: { id: true, name: true } }),
        actorId ? this.users.findOne({ where: { id: actorId }, select: { id: true, name: true } }) : null,
      ]);
      const text = build(group?.name ?? 'your trip', actor?.name ?? null);
      await this.record(userIds, { type, ...text, data: { ...data, groupId } });
    } catch (err) {
      this.logger.warn(`Could not record a ${type} notification: ${(err as Error).message}`);
    }
  }

  /** A trip event for every current member of the group except `exceptUserId` (usually the actor). */
  async recordForGroup(
    groupId: string,
    exceptUserId: string | null,
    type: string,
    build: (trip: string, actor: string | null) => { title: string; body: string },
    data: Record<string, string> = {},
  ): Promise<void> {
    try {
      const members = await this.members.find({ where: { groupId }, select: { userId: true } });
      const userIds = members.map((m) => m.userId).filter((id) => id !== exceptUserId);
      await this.recordTripEvent(userIds, type, groupId, exceptUserId, build, data);
    } catch (err) {
      this.logger.warn(`Could not record a ${type} notification: ${(err as Error).message}`);
    }
  }

  /** Newest first, paged with `before` (an id from the previous page). */
  async list(userId: string, limit = DEFAULT_LIMIT, before?: string) {
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(limit + 1);
    if (before) {
      const cursor = await this.notifications.findOne({ where: { id: before, userId } });
      if (!cursor) throw new BadRequestException('before must be a notification id from your feed');
      qb.andWhere('(n.created_at, n.id) < (:cAt, :cId)', { cAt: cursor.createdAt, cId: cursor.id });
    }
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return {
      items: page.map(toView),
      nextBefore: rows.length > limit ? page[page.length - 1].id : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.countBy({ userId, readAt: IsNull() });
  }

  /** Marks the given entries read (only the caller's), or all of them when `ids` is left out. */
  async markRead(userId: string, ids?: string[]): Promise<{ unreadCount: number }> {
    const where = ids ? { userId, id: In(ids), readAt: IsNull() } : { userId, readAt: IsNull() };
    await this.notifications.update(where, { readAt: new Date() });
    return { unreadCount: await this.unreadCount(userId) };
  }

  /** Retention: entries older than NOTIFICATION_RETENTION_DAYS are deleted. */
  async deleteOld(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
    return (await this.notifications.delete({ createdAt: LessThan(cutoff) })).affected ?? 0;
  }
}

function toView(n: Notification): NotificationView {
  return {
    id: n.id,
    type: n.type,
    groupId: n.groupId,
    title: n.title,
    body: n.body,
    data: n.data,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}
