import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupMember, User } from '../database/entities/index.js';
import { RealtimeService } from './realtime.service.js';

export const PRESENCE_UPDATED_EVENT = 'presence:updated';
const DEFAULT_OFFLINE_GRACE_MS = 5000;

export interface PresenceView {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  lastSeenAt: Date | null;
}

/**
 * Online / offline presence. A user is online while at least one of their devices has a socket
 * open. Changes go to everyone who shares a group with them as `presence:updated`
 * `{ userId, online, lastSeenAt }`.
 *
 * Going offline waits a short grace period (PRESENCE_OFFLINE_GRACE_MS, default 5 s) so a quick
 * reconnect (token refresh, network blip) doesn't flash "offline" to the group.
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly pendingOffline = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
  ) {}

  onModuleDestroy(): void {
    this.pendingOffline.forEach((timer) => clearTimeout(timer));
    this.pendingOffline.clear();
  }

  private get graceMs(): number {
    const raw = this.config.get<string>('PRESENCE_OFFLINE_GRACE_MS');
    const value = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_OFFLINE_GRACE_MS;
  }

  /** Called by the gateway after a socket has joined the user's room. */
  async userConnected(userId: string): Promise<void> {
    const pending = this.pendingOffline.get(userId);
    if (pending) {
      // Reconnected within the grace period: the group never saw them go offline.
      clearTimeout(pending);
      this.pendingOffline.delete(userId);
      return;
    }
    // Only the first device announces "online"; extra devices change nothing.
    if ((await this.realtime.socketCount(userId)) === 1) await this.announce(userId, true, null);
  }

  /** Called by the gateway after a socket has closed. */
  userDisconnected(userId: string): void {
    if (this.pendingOffline.has(userId)) return;
    const timer = setTimeout(() => {
      this.pendingOffline.delete(userId);
      this.goOfflineIfNoSockets(userId).catch((err: Error) =>
        this.logger.warn(`Presence update for ${userId} failed: ${err.message}`),
      );
    }, this.graceMs);
    timer.unref();
    this.pendingOffline.set(userId, timer);
  }

  /** Presence of every current member of the group. */
  async groupPresence(groupId: string): Promise<PresenceView[]> {
    const members = await this.members.find({ where: { groupId }, relations: { user: true } });
    const online = await this.realtime.onlineUserIds(members.map((m) => m.userId));
    return members
      .map(({ user }) => ({
        userId: user.id,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        online: online.has(user.id),
        lastSeenAt: online.has(user.id) ? null : user.lastSeenAt,
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  private async goOfflineIfNoSockets(userId: string): Promise<void> {
    if ((await this.realtime.socketCount(userId)) > 0) return;
    const lastSeenAt = new Date();
    await this.users.update({ id: userId }, { lastSeenAt });
    await this.announce(userId, false, lastSeenAt);
  }

  private async announce(userId: string, online: boolean, lastSeenAt: Date | null): Promise<void> {
    const coMembers = await this.realtime.coMemberIds(userId);
    this.realtime.emitToUsers(coMembers, PRESENCE_UPDATED_EVENT, { userId, online, lastSeenAt });
  }
}
