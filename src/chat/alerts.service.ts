import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  type AlertLocation,
  GroupMember,
  GroupRole,
  Message,
  MessageAck,
  MessageType,
} from '../database/entities/index.js';
import { LocationService } from '../location/location.service.js';
import { PushService } from '../notifications/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ChatService, requiresAck, userSummary, type MessageView } from './chat.service.js';
import { ALERT_TYPES, type AlertsQueryDto, type CreateAlertDto, type RaiseSosDto } from './dto/alerts.dto.js';

export const AlertEvents = {
  RAISED: 'alert:raised', // to group: show the banner (GENERAL / CRITICAL / SOS)
  ACKNOWLEDGED: 'alert:acknowledged', // to group: a member acknowledged a CRITICAL / SOS alert
  RESOLVED: 'alert:resolved', // to group: a CRITICAL / SOS alert is over, remove the banner
} as const;

export const DEFAULT_SOS_BODY = 'SOS: I need help';
const DEFAULT_PAGE = 20;

const PUSH_TYPE: Record<(typeof ALERT_TYPES)[number], string> = {
  [MessageType.GENERAL]: 'GENERAL_ALERT',
  [MessageType.CRITICAL]: 'CRITICAL_ALERT',
  [MessageType.SOS]: 'SOS',
};

/**
 * Alerts (PDF §2.5): GENERAL announcements and CRITICAL alerts (weather / road closure / safety)
 * from admins, and SOS from any member. Each is also a message in the chat timeline.
 *
 * All alerts are pushed to every other member (online or not) and broadcast as `alert:raised`
 * (plus `chat:message` for the timeline). CRITICAL / SOS stay active (red banner) until
 * resolved, and members acknowledge them so the sender can see who has seen it.
 *
 * SOS notifies the group only. It does NOT contact emergency services (PDF §8); the app must
 * say so (see the SOS disclaimer in API_DOCUMENTATION.md).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(MessageAck) private readonly acks: Repository<MessageAck>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly location: LocationService,
  ) {}

  /** Admins only (enforced by the route). */
  async create(groupId: string, senderId: string, dto: CreateAlertDto): Promise<MessageView> {
    if (dto.type === MessageType.GENERAL && dto.category) {
      throw new BadRequestException('category is only for CRITICAL alerts');
    }
    return this.raise(groupId, senderId, {
      type: dto.type,
      body: dto.body,
      category: dto.type === MessageType.CRITICAL ? dto.category! : null,
    });
  }

  /**
   * Any member. Location: the device's coordinates if sent, else the sender's live-location
   * position (if they're sharing), else none. A second SOS while one is still active returns
   * the active one (a panicked double tap shouldn't create two).
   */
  async raiseSos(groupId: string, senderId: string, dto: RaiseSosDto): Promise<MessageView> {
    const active = await this.messages.findOne({
      where: { groupId, senderId, type: MessageType.SOS, resolvedAt: IsNull() },
      relations: { sender: true, resolvedBy: true },
    });
    if (active) return (await this.chat.buildViews(groupId, [active], senderId))[0];

    let location: AlertLocation | null = null;
    if (dto.lat !== undefined && dto.lng !== undefined) {
      location = { lat: dto.lat, lng: dto.lng, accuracy: dto.accuracy ?? null, recordedAt: new Date().toISOString(), source: 'DEVICE' };
    } else {
      const live = await this.location.livePosition(groupId, senderId);
      if (live) location = { lat: live.lat, lng: live.lng, accuracy: live.accuracy, recordedAt: live.recordedAt, source: 'LIVE_SHARE' };
    }
    return this.raise(groupId, senderId, { type: MessageType.SOS, body: dto.body || DEFAULT_SOS_BODY, location });
  }

  /** Newest first. `active=true` = unresolved CRITICAL / SOS (the banners to show). */
  async list(groupId: string, viewerId: string, query: AlertsQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE;
    const types = query.type ? [query.type] : query.active ? [MessageType.CRITICAL, MessageType.SOS] : [...ALERT_TYPES];
    const qb = this.messages
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.sender', 'sender')
      .leftJoinAndSelect('m.resolvedBy', 'resolver')
      .where('m.group_id = :groupId', { groupId })
      .andWhere('m.type IN (:...types)', { types })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .limit(limit + 1);
    if (query.active === true) qb.andWhere('m.resolved_at IS NULL AND m.type IN (:...ackTypes)', { ackTypes: [MessageType.CRITICAL, MessageType.SOS] });
    if (query.active === false) qb.andWhere('(m.resolved_at IS NOT NULL OR m.type = :general)', { general: MessageType.GENERAL });
    if (query.before) {
      const cursor = await this.messages.findOne({ where: { id: query.before, groupId }, select: { id: true, createdAt: true } });
      if (!cursor) throw new BadRequestException('before must be the id of an alert in this group');
      qb.andWhere('(m.created_at, m.id) < (:cursorAt, :cursorId)', { cursorAt: cursor.createdAt, cursorId: cursor.id });
    }

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const items = await this.chat.buildViews(groupId, page, viewerId);
    return { items, nextBefore: rows.length > limit ? items[items.length - 1].id : null };
  }

  /** One alert, with who has acknowledged it and who hasn't yet. */
  async get(groupId: string, viewerId: string, alertId: string) {
    const alert = await this.findAlert(groupId, alertId);
    const [[view], acks, members] = await Promise.all([
      this.chat.buildViews(groupId, [alert], viewerId),
      this.acks.find({ where: { messageId: alert.id }, relations: { user: true }, order: { ackedAt: 'ASC' } }),
      this.members.find({ where: { groupId }, relations: { user: true } }),
    ]);
    if (!requiresAck(alert.type)) return { ...view, acknowledgements: [], pending: [] };

    const audience = members.filter((m) => m.userId !== alert.senderId);
    const acked = new Set(acks.map((a) => a.userId));
    return {
      ...view,
      acknowledgements: acks
        .filter((a) => audience.some((m) => m.userId === a.userId))
        .map((a) => ({ ...userSummary(a.user), ackedAt: a.ackedAt })),
      pending: audience
        .filter((m) => !acked.has(m.userId))
        .map((m) => userSummary(m.user))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Idempotent: acknowledging twice keeps the first time. */
  async acknowledge(groupId: string, membership: GroupMember, alertId: string): Promise<MessageView> {
    const alert = await this.findAlert(groupId, alertId);
    if (!requiresAck(alert.type)) throw new BadRequestException('Only CRITICAL and SOS alerts are acknowledged');
    if (alert.senderId === membership.userId) throw new BadRequestException('You raised this alert');

    const insert = await this.acks
      .createQueryBuilder()
      .insert()
      .values({ messageId: alert.id, userId: membership.userId })
      .orIgnore()
      .returning(['acked_at'])
      .execute();
    const [view] = await this.chat.buildViews(groupId, [alert], membership.userId);

    if ((insert.raw as unknown[]).length) {
      const ack = await this.acks.findOneOrFail({ where: { messageId: alert.id, userId: membership.userId }, relations: { user: true } });
      await this.realtime.emitToGroup(groupId, AlertEvents.ACKNOWLEDGED, {
        groupId,
        alertId: alert.id,
        type: alert.type,
        ...userSummary(ack.user),
        ackedAt: ack.ackedAt,
        ackCount: view.alert!.ackCount,
        pendingCount: view.alert!.pendingCount,
      });
      if (alert.type === MessageType.SOS) {
        // The person in trouble wants to know someone has seen it, even with the app closed.
        this.push
          .sendToUser(alert.senderId, {
            title: `${ack.user.name} saw your SOS`,
            body: `${view.alert!.ackCount} of ${view.alert!.ackCount + view.alert!.pendingCount} members have seen it`,
            data: { type: 'SOS_ACKNOWLEDGED', groupId, alertId: alert.id, userId: ack.userId },
          })
          .catch((err: Error) => this.logger.warn(`SOS ack push failed: ${err.message}`));
      }
    }
    return view;
  }

  /**
   * Ends a CRITICAL / SOS alert (banner goes away). SOS: the sender ("I'm safe") or an admin.
   * CRITICAL: admins. Resolving twice returns the alert unchanged.
   */
  async resolve(groupId: string, membership: GroupMember, alertId: string): Promise<MessageView> {
    const alert = await this.findAlert(groupId, alertId);
    if (!requiresAck(alert.type)) throw new BadRequestException('Only CRITICAL and SOS alerts can be resolved');
    const isAdmin = membership.role === GroupRole.ADMIN;
    const allowed = alert.type === MessageType.SOS ? isAdmin || alert.senderId === membership.userId : isAdmin;
    if (!allowed) {
      throw new ForbiddenException(
        alert.type === MessageType.SOS ? 'Only the sender or an admin can resolve an SOS' : 'Only admins can resolve a critical alert',
      );
    }

    if (!alert.resolvedAt) {
      const resolvedAt = new Date();
      const updated = await this.messages.update(
        { id: alert.id, resolvedAt: IsNull() },
        { resolvedAt, resolvedById: membership.userId },
      );
      if (updated.affected) {
        const resolved = await this.chat.loadMessage(alert.id);
        const payload = {
          groupId,
          alertId: alert.id,
          type: alert.type,
          resolvedAt: resolved.resolvedAt,
          resolvedBy: resolved.resolvedBy ? userSummary(resolved.resolvedBy) : null,
        };
        await this.realtime.emitToGroup(groupId, AlertEvents.RESOLVED, payload);
        if (alert.type === MessageType.SOS) this.pushSosResolved(resolved).catch((err: Error) => this.logger.warn(`SOS resolved push failed: ${err.message}`));
      }
    }
    return (await this.chat.buildViews(groupId, [await this.chat.loadMessage(alert.id)], membership.userId))[0];
  }

  // --- internals ---

  private async raise(groupId: string, senderId: string, input: Parameters<ChatService['post']>[2]): Promise<MessageView> {
    const { view } = await this.chat.post(groupId, senderId, input);
    await this.realtime.emitToGroup(groupId, AlertEvents.RAISED, view);
    this.pushAlert(view).catch((err: Error) => this.logger.warn(`Alert push failed: ${err.message}`));
    return view;
  }

  private async findAlert(groupId: string, alertId: string): Promise<Message> {
    const alert = await this.messages.findOne({
      where: { id: alertId, groupId, type: In([...ALERT_TYPES]) },
      relations: { sender: true, resolvedBy: true },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }

  // Alerts go to every other member, online or not: they must not be missed.
  private async pushAlert(view: MessageView): Promise<void> {
    const recipients = (await this.realtime.groupMemberIds(view.groupId)).filter((id) => id !== view.sender.userId);
    const groupName = await this.chat.groupName(view.groupId);
    const title =
      view.type === MessageType.SOS
        ? `SOS from ${view.sender.name}`
        : view.type === MessageType.CRITICAL
          ? `Critical alert: ${groupName}`
          : groupName;
    const data: Record<string, string> = { type: PUSH_TYPE[view.type as (typeof ALERT_TYPES)[number]], groupId: view.groupId, alertId: view.id };
    if (view.category) data.category = view.category;
    if (view.location) {
      data.lat = String(view.location.lat);
      data.lng = String(view.location.lng);
    }
    await this.push.sendToUsers(recipients, {
      title,
      body: view.type === MessageType.SOS ? `${groupName}: ${view.body}` : view.body,
      data,
    });
  }

  private async pushSosResolved(alert: Message): Promise<void> {
    const recipients = (await this.realtime.groupMemberIds(alert.groupId)).filter((id) => id !== alert.resolvedById);
    const byself = alert.resolvedById === alert.senderId;
    await this.push.sendToUsers(recipients, {
      title: byself ? `${alert.sender.name} is safe` : `SOS from ${alert.sender.name} resolved`,
      body: byself
        ? `${alert.sender.name} marked their SOS as resolved.`
        : `${alert.resolvedBy?.name ?? 'An admin'} marked the SOS as resolved.`,
      data: { type: 'SOS_RESOLVED', groupId: alert.groupId, alertId: alert.id },
    });
  }
}
