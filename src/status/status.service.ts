import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Group, GroupMember, StatusUpdate, TripStatus, type User } from '../database/entities/index.js';
import { PushService } from '../notifications/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { SetStatusDto } from './dto/set-status.dto.js';
import type { StatusHistoryQueryDto } from './dto/status-history-query.dto.js';

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
export const STATUS_UPDATED_EVENT = 'status:updated';

export interface StatusView {
  id: string;
  groupId: string;
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  status: TripStatus;
  note: string | null;
  createdAt: Date;
}

/**
 * Trip status (PDF §2.6): each member marks Arrived / Stopped / Need Help / In Transit.
 * Every change is a new row (append-only history for trip review). A member's current
 * status is their latest row. Changes are pushed live over the socket as `status:updated`.
 * NEED_HELP also sends a push notification to the rest of the group.
 */
@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    @InjectRepository(StatusUpdate) private readonly statuses: Repository<StatusUpdate>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  async setStatus(groupId: string, userId: string, dto: SetStatusDto): Promise<StatusView> {
    if (dto.clientId) {
      const existing = await this.findByClientId(groupId, userId, dto.clientId);
      if (existing) return this.toView(existing); // a retry: no second event or push
    }
    const createdAt = this.recordedAt(dto.recordedAt);

    let saved: StatusUpdate;
    try {
      saved = await this.statuses.save(
        this.statuses.create({
          groupId,
          userId,
          status: dto.status,
          note: dto.note?.trim() || null,
          clientId: dto.clientId ?? null,
          ...(createdAt && { createdAt }),
        }),
      );
    } catch (err) {
      const isDuplicate = err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505';
      const existing = dto.clientId && isDuplicate ? await this.findByClientId(groupId, userId, dto.clientId) : null;
      if (existing) return this.toView(existing);
      throw err;
    }
    const update = await this.statuses.findOneOrFail({ where: { id: saved.id }, relations: { user: true } });
    const view = this.toView(update);
    await this.realtime.emitToGroup(groupId, STATUS_UPDATED_EVENT, view);
    if (view.status === TripStatus.NEED_HELP) {
      this.pushNeedHelp(view).catch((err: Error) => this.logger.warn(`NEED_HELP push failed: ${err.message}`));
    }
    return view;
  }

  private findByClientId(groupId: string, userId: string, clientId: string): Promise<StatusUpdate | null> {
    return this.statuses.findOne({ where: { groupId, userId, clientId }, relations: { user: true } });
  }

  /** A status set offline keeps the time it happened (up to 7 days back, never in the future). */
  private recordedAt(value: string | undefined): Date | null {
    if (!value) return null;
    const at = new Date(value);
    const now = Date.now();
    if (at.getTime() > now + CLOCK_SKEW_MS) throw new BadRequestException("recordedAt can't be in the future");
    if (at.getTime() < now - MAX_BACKDATE_MS) throw new BadRequestException('recordedAt can be at most 7 days ago');
    return at.getTime() > now ? new Date(now) : at;
  }

  // Fire-and-forget: the response doesn't wait for FCM.
  private async pushNeedHelp(view: StatusView): Promise<void> {
    const [group, memberIds] = await Promise.all([
      this.groups.findOne({ where: { id: view.groupId }, select: { id: true, name: true } }),
      this.realtime.groupMemberIds(view.groupId),
    ]);
    await this.push.sendToUsers(
      memberIds.filter((id) => id !== view.userId),
      {
        title: `${view.name} needs help`,
        body: view.note ? `${group?.name ?? 'Your group'}: ${view.note}` : `Status in ${group?.name ?? 'your group'}: Need Help`,
        data: { type: 'STATUS_NEED_HELP', groupId: view.groupId, userId: view.userId, statusId: view.id },
      },
    );
  }

  /** Every current member with their latest status (null if they haven't set one). */
  async current(groupId: string) {
    const [members, latest] = await Promise.all([
      this.members.find({ where: { groupId }, relations: { user: true } }),
      this.statuses
        .createQueryBuilder('s')
        .distinctOn(['s.user_id'])
        .where('s.group_id = :groupId', { groupId })
        .orderBy('s.user_id')
        .addOrderBy('s.created_at', 'DESC')
        .getMany(),
    ]);
    const byUser = new Map(latest.map((s) => [s.userId, s]));
    return members
      .map((m) => {
        const s = byUser.get(m.userId);
        return {
          ...this.userSummary(m.user),
          role: m.role,
          status: s ? { status: s.status, note: s.note, updatedAt: s.createdAt } : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Newest first. Page with `before` = the previous page's `nextBefore`. */
  async history(groupId: string, query: StatusHistoryQueryDto) {
    const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;
    const qb = this.statuses
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.user', 'u')
      .where('s.group_id = :groupId', { groupId })
      .orderBy('s.created_at', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .limit(limit + 1); // one extra row tells us whether another page exists (the user join is 1:1)
    if (query.userId) qb.andWhere('s.user_id = :userId', { userId: query.userId });
    if (query.before) qb.andWhere('s.created_at < :before', { before: new Date(query.before) });

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return {
      items: page.map((s) => this.toView(s)),
      nextBefore: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  private toView(s: StatusUpdate): StatusView {
    return {
      id: s.id,
      groupId: s.groupId,
      ...this.userSummary(s.user),
      status: s.status,
      note: s.note,
      createdAt: s.createdAt,
    };
  }

  private userSummary(user: User) {
    return { userId: user.id, username: user.username, name: user.name, avatarUrl: user.avatarUrl };
  }
}
