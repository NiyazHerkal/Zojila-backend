import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  AlertCategory,
  type AlertLocation,
  Group,
  GroupMember,
  Message,
  MessageAck,
  MessageKind,
  MessageRead,
  MessageType,
  type User,
} from '../database/entities/index.js';
import { GroupAccessService } from '../groups/group-access.service.js';
import { CLOSED_TRIP_MESSAGE } from '../groups/guards/group-member.guard.js';
import { PushService } from '../notifications/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { MessagesQueryDto, SharedLocationDto } from './dto/chat.dto.js';
import { detectVoiceType, VOICE_MAX_BYTES } from './voice-file.js';

export const ChatEvents = {
  MESSAGE: 'chat:message', // to group: a new message or alert, for the chat timeline
  TYPING: 'chat:typing', // to the group except the typist
  READ: 'chat:read', // to group: a member's read marker moved
  MESSAGE_DELETED: 'chat:message_deleted', // to group: a sender deleted their message
} as const;

const DEFAULT_PAGE = 50;
const PUSH_PREVIEW_LENGTH = 120;
const REPLY_PREVIEW_LENGTH = 100;

export interface UserSummary {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export interface AlertSummary {
  /** CRITICAL and SOS need acknowledging; GENERAL doesn't. */
  requiresAck: boolean;
  /** Unresolved CRITICAL / SOS: show the banner. */
  active: boolean;
  /** Current members (other than the sender) who acknowledged / haven't yet. */
  ackCount: number;
  pendingCount: number;
  acknowledgedByMe: boolean;
  resolvedAt: Date | null;
  resolvedBy: UserSummary | null;
}

/** The message a reply answers, enough to draw the quote above the reply. */
export interface ReplyPreview {
  id: string;
  sender: UserSummary;
  type: MessageType;
  kind: MessageKind;
  /** The start of its text (or a location's label / caption); "" for voice and deleted messages. */
  preview: string;
  deleted: boolean;
}

export interface MessageView {
  id: string;
  groupId: string;
  type: MessageType;
  /** TEXT, LOCATION (see `location`) or VOICE (see `voice`; play it from …/messages/:id/voice). */
  kind: MessageKind;
  category: AlertCategory | null;
  body: string;
  clientMsgId: string | null;
  sender: UserSummary;
  location: AlertLocation | null;
  voice: { durationMs: number; contentType: string } | null;
  /** The message this one answers; null if it isn't a reply. */
  replyTo: ReplyPreview | null;
  /** A copy of a message forwarded from somewhere (where from isn't shown). */
  forwarded: boolean;
  /** Set when the sender deleted it: body is "", location and voice are null. */
  deletedAt: Date | null;
  createdAt: Date;
  /** Current members other than the sender whose read marker is at or past this message. */
  readByCount: number;
  /** Only on alerts (type ≠ NORMAL). */
  alert?: AlertSummary;
}

export interface NewMessage {
  type: MessageType;
  kind?: MessageKind;
  body: string;
  voice?: { key: string; contentType: string; durationMs: number } | null;
  category?: AlertCategory | null;
  location?: AlertLocation | null;
  clientMsgId?: string | null;
  replyToId?: string | null;
  forwarded?: boolean;
}

export const isAlert = (type: MessageType) => type !== MessageType.NORMAL;
export const requiresAck = (type: MessageType) => type === MessageType.CRITICAL || type === MessageType.SOS;

export const userSummary = (user: User): UserSummary => ({
  userId: user.id,
  username: user.username,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Group chat (PDF §2.5): real-time messages with sender + timestamp, read receipts, typing
 * indicators and searchable history. Messages are sent over the socket (`chat:send`, see
 * ChatGateway); history, search and read markers are also available over HTTP.
 *
 * Alerts (AlertsService) are stored and broadcast through the same timeline.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(MessageRead) private readonly reads: Repository<MessageRead>,
    @InjectRepository(MessageAck) private readonly acks: Repository<MessageAck>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly access: GroupAccessService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly storage: StorageService,
  ) {}

  /** Membership check for socket events (HTTP routes use GroupMemberGuard). Same 404 rule. */
  async requireMember(groupId: string, userId: string): Promise<GroupMember> {
    const membership = await this.access.findMembership(groupId, userId);
    if (!membership) throw new NotFoundException('Group not found');
    return membership;
  }

  /**
   * `chat:send`: a text message (emoji included) or a shared location. Chat messages push only
   * to members who are offline (online ones get the socket event).
   */
  async sendMessage(
    groupId: string,
    userId: string,
    input: {
      kind?: MessageKind;
      body?: string;
      location?: SharedLocationDto;
      replyToMessageId?: string;
      forwardFromMessageId?: string;
    },
    clientMsgId?: string,
  ): Promise<MessageView> {
    const membership = await this.requireMember(groupId, userId);
    if (membership.group.closedAt) throw new ConflictException(CLOSED_TRIP_MESSAGE);
    if (clientMsgId) {
      const existing = await this.findByClientMsgId(userId, clientMsgId);
      if (existing) return this.existingForResend(existing, groupId, userId);
    }
    if (input.forwardFromMessageId) {
      if (input.body !== undefined || input.location || input.replyToMessageId) {
        throw new BadRequestException('To forward, send only forwardFromMessageId (no body, location or replyToMessageId)');
      }
      return this.forward(groupId, userId, input.forwardFromMessageId, clientMsgId);
    }

    const kind = input.kind ?? MessageKind.TEXT;
    if (kind === MessageKind.TEXT && !input.body) throw new BadRequestException('body is required');
    if (kind !== MessageKind.LOCATION && input.location) {
      throw new BadRequestException('location is only for LOCATION messages (send kind: "LOCATION")');
    }
    const replyToId = await this.replyTarget(groupId, input.replyToMessageId);
    const message: NewMessage = { type: MessageType.NORMAL, kind, body: input.body ?? '', clientMsgId, replyToId };
    if (kind === MessageKind.LOCATION && input.location) {
      const { lat, lng, accuracy, label } = input.location;
      message.location = { lat, lng, accuracy: accuracy ?? null, recordedAt: new Date().toISOString(), source: 'DEVICE', label: label || null };
    }
    return this.postChat(groupId, userId, message, clientMsgId);
  }

  /**
   * A voice message (change request v1.0, change 8): the recording is checked (AAC/M4A/Ogg by its
   * content, ≤ 2 MB, ≤ 2 min, no video), stored, and posted to the timeline like any message.
   */
  async sendVoice(
    groupId: string,
    userId: string,
    file: { buffer: Buffer; size: number } | undefined,
    durationMs: number,
    clientMsgId?: string,
    replyToMessageId?: string,
  ): Promise<MessageView> {
    if (clientMsgId) {
      const existing = await this.findByClientMsgId(userId, clientMsgId);
      if (existing) return this.existingForResend(existing, groupId, userId);
    }
    if (!file?.buffer?.length) throw new BadRequestException('Attach the recording as multipart field "file"');
    if (file.size > VOICE_MAX_BYTES) throw new PayloadTooLargeException('A voice message must be 2 MB or smaller');
    const type = detectVoiceType(file.buffer);
    if (!type) throw new UnsupportedMediaTypeException('A voice message must be an AAC/M4A or Ogg audio recording');
    const replyToId = await this.replyTarget(groupId, replyToMessageId);

    const key = `voice/${groupId}/${randomUUID()}.${type.extension}`;
    await this.storage.put(key, file.buffer, type.contentType);
    return this.postWithRecording(
      groupId,
      userId,
      { type: MessageType.NORMAL, kind: MessageKind.VOICE, body: '', voice: { key, contentType: type.contentType, durationMs }, clientMsgId, replyToId },
      clientMsgId,
    );
  }

  /**
   * Forwards a chat message from any group the sender is in now: a copy (text, location, or a
   * copy of the recording) marked `forwarded`, without saying where it came from.
   */
  private async forward(groupId: string, userId: string, sourceId: string, clientMsgId?: string): Promise<MessageView> {
    const source = await this.messages.findOne({ where: { id: sourceId } });
    // From a group the sender isn't in, the message doesn't exist for them.
    if (!source || !(await this.access.findMembership(source.groupId, userId))) {
      throw new NotFoundException('Message to forward not found');
    }
    if (source.type !== MessageType.NORMAL) throw new BadRequestException("Alerts can't be forwarded");
    if (source.deletedAt) throw new BadRequestException("That message was deleted, so it can't be forwarded");

    const message: NewMessage = {
      type: MessageType.NORMAL,
      kind: source.kind,
      body: source.body,
      location: source.location,
      forwarded: true,
      clientMsgId,
    };
    if (source.kind !== MessageKind.VOICE) return this.postChat(groupId, userId, message, clientMsgId);

    // Each message owns its recording (deleting one mustn't silence the other), so copy it.
    const data = source.voiceKey ? await this.storage.get(source.voiceKey) : null;
    if (!data || !source.voiceKey || !source.voiceContentType) throw new NotFoundException('The recording is missing');
    const key = `voice/${groupId}/${randomUUID()}.${source.voiceKey.split('.').pop()}`;
    await this.storage.put(key, data, source.voiceContentType);
    message.voice = { key, contentType: source.voiceContentType, durationMs: source.voiceDurationMs ?? 0 };
    return this.postWithRecording(groupId, userId, message, clientMsgId);
  }

  /** Posts a message whose recording is already stored, and removes the file if it isn't used. */
  private async postWithRecording(groupId: string, userId: string, message: NewMessage, clientMsgId?: string): Promise<MessageView> {
    const key = message.voice!.key;
    let view: MessageView;
    try {
      view = await this.postChat(groupId, userId, message, clientMsgId);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined); // not posted: drop the file
      throw err;
    }
    if (clientMsgId) {
      // A retry that raced the original returns the original; this upload's file isn't used.
      const saved = await this.messages.findOne({ where: { id: view.id }, select: { id: true, voiceKey: true } });
      if (saved?.voiceKey !== key) await this.storage.delete(key).catch(() => undefined);
    }
    return view;
  }

  /**
   * The sender deletes their own chat message (not alerts). It stays in the timeline as
   * "deleted", with its text, location and recording wiped, so replies to it and read markers
   * still line up. The group gets `chat:message_deleted`. Deleting again changes nothing.
   */
  async deleteMessage(groupId: string, userId: string, messageId: string): Promise<MessageView> {
    const message = await this.messages.findOne({ where: { id: messageId, groupId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.type !== MessageType.NORMAL) throw new BadRequestException("Alerts can't be deleted");
    if (message.senderId !== userId) throw new ForbiddenException('You can only delete your own messages');

    if (!message.deletedAt) {
      const deletedAt = new Date();
      const result = await this.messages.update(
        { id: message.id, deletedAt: IsNull() },
        { deletedAt, body: '', location: null, voiceKey: null, voiceContentType: null, voiceDurationMs: null },
      );
      if (result.affected) {
        if (message.voiceKey) await this.storage.delete(message.voiceKey).catch(() => undefined);
        await this.realtime.emitToGroup(groupId, ChatEvents.MESSAGE_DELETED, { groupId, messageId: message.id, deletedAt });
      }
    }
    return (await this.buildViews(groupId, [await this.loadMessage(message.id)], userId))[0];
  }

  /** The recording of a voice message, for any member. */
  async getVoice(groupId: string, messageId: string) {
    const message = await this.messages.findOne({ where: { id: messageId, groupId } });
    if (!message?.voiceKey || !message.voiceContentType) throw new NotFoundException('Voice message not found');
    const data = await this.storage.get(message.voiceKey);
    if (!data) throw new NotFoundException('The recording is missing');
    return { data, contentType: message.voiceContentType, filename: `voice-${message.id.slice(0, 8)}.${message.voiceKey.split('.').pop()}` };
  }

  private async postChat(groupId: string, userId: string, input: NewMessage, clientMsgId?: string): Promise<MessageView> {
    let view: MessageView;
    try {
      ({ view } = await this.post(groupId, userId, input));
    } catch (err) {
      // Two sends with the same clientMsgId raced: return the one that won.
      if (clientMsgId && isUniqueViolation(err)) {
        const existing = await this.findByClientMsgId(userId, clientMsgId);
        if (existing) return this.existingForResend(existing, groupId, userId);
      }
      throw err;
    }

    this.pushToOfflineMembers(view).catch((err: Error) => this.logger.warn(`Chat push failed: ${err.message}`));
    return view;
  }

  /**
   * Saves a message or alert, moves the sender's read marker to it (sending = you've read the
   * chat) and broadcasts it to the group as `chat:message`. Returns the saved row (with
   * relations) and its view. The view's personal flag (`acknowledgedByMe`) is false, which is
   * right for everyone: the sender never acknowledges their own alert, and nobody else has yet.
   */
  async post(groupId: string, senderId: string, input: NewMessage): Promise<{ message: Message; view: MessageView }> {
    const saved = await this.messages.save(
      this.messages.create({
        groupId,
        senderId,
        type: input.type,
        kind: input.kind ?? MessageKind.TEXT,
        body: input.body,
        category: input.category ?? null,
        location: input.location ?? null,
        voiceKey: input.voice?.key ?? null,
        voiceContentType: input.voice?.contentType ?? null,
        voiceDurationMs: input.voice?.durationMs ?? null,
        clientMsgId: input.clientMsgId ?? null,
        replyToId: input.replyToId ?? null,
        forwarded: input.forwarded ?? false,
      }),
    );
    const message = await this.loadMessage(saved.id);
    await this.advanceReadMarker(groupId, senderId, message);
    const [view] = await this.buildViews(groupId, [message], senderId);
    await this.realtime.emitToGroup(groupId, ChatEvents.MESSAGE, view);
    return { message, view };
  }

  /** History, oldest first within the page (chat order). Page backwards with `before`. */
  async list(groupId: string, userId: string, query: MessagesQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE;
    const qb = this.messages
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.sender', 'sender')
      .leftJoinAndSelect('m.resolvedBy', 'resolver')
      .where('m.group_id = :groupId', { groupId })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .limit(limit + 1); // one extra row tells us whether an older page exists

    if (query.before) {
      const cursor = await this.messages.findOne({ where: { id: query.before, groupId }, select: { id: true, createdAt: true } });
      if (!cursor) throw new BadRequestException('before must be the id of a message in this group');
      qb.andWhere('(m.created_at, m.id) < (:cursorAt, :cursorId)', { cursorAt: cursor.createdAt, cursorId: cursor.id });
    }
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      qb.andWhere(`m.body ILIKE :pattern ESCAPE '\\'`, { pattern });
    }

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const items = await this.buildViews(groupId, page.reverse(), userId);
    return { items, nextBefore: rows.length > limit ? items[0].id : null };
  }

  /** Unread = messages from others after my read marker (or since I joined, if I've never read). */
  async unread(groupId: string, membership: GroupMember) {
    const marker = await this.reads.findOne({ where: { groupId, userId: membership.userId } });
    const unreadCount = await this.messages
      .createQueryBuilder('m')
      .where('m.group_id = :groupId', { groupId })
      .andWhere('m.sender_id <> :userId', { userId: membership.userId })
      .andWhere('m.deleted_at IS NULL')
      .andWhere('m.created_at > :since', { since: marker?.lastReadAt ?? membership.joinedAt })
      .getCount();
    return {
      unreadCount,
      lastReadMessageId: marker?.lastReadMessageId ?? null,
      lastReadAt: marker?.lastReadAt ?? null,
    };
  }

  /** Marks everything up to `messageId` as read. Markers only move forward. */
  async markRead(groupId: string, membership: GroupMember, messageId: string) {
    const message = await this.messages.findOne({ where: { id: messageId, groupId } });
    if (!message) throw new NotFoundException('Message not found');
    await this.advanceReadMarker(groupId, membership.userId, message);
    return this.unread(groupId, membership);
  }

  /** Who (among current members other than the sender) has read this message. */
  async readers(groupId: string, messageId: string) {
    const message = await this.messages.findOne({ where: { id: messageId, groupId } });
    if (!message) throw new NotFoundException('Message not found');
    const [members, markers] = await Promise.all([
      this.members.find({ where: { groupId }, relations: { user: true } }),
      this.reads.find({ where: { groupId } }),
    ]);
    const readAt = new Map(markers.map((r) => [r.userId, r.lastReadAt.getTime()]));
    const others = members.filter((m) => m.userId !== message.senderId).map((m) => m.user);
    const byName = (a: UserSummary, b: UserSummary) => a.name.localeCompare(b.name);
    const hasRead = (u: User) => (readAt.get(u.id) ?? -Infinity) >= message.createdAt.getTime();
    return {
      messageId,
      readBy: others.filter(hasRead).map(userSummary).sort(byName),
      notReadYet: others.filter((u) => !hasRead(u)).map(userSummary).sort(byName),
    };
  }

  /** `chat:typing`: relayed to the rest of the group, nothing stored. */
  async typing(groupId: string, userId: string, isTyping: boolean) {
    const membership = await this.members.findOne({ where: { groupId, userId }, relations: { user: true } });
    if (!membership) throw new NotFoundException('Group not found');
    await this.realtime.emitToGroup(
      groupId,
      ChatEvents.TYPING,
      { groupId, ...userSummary(membership.user), isTyping },
      { exceptUserId: userId },
    );
    return { groupId, isTyping };
  }

  async loadMessage(id: string): Promise<Message> {
    return this.messages.findOneOrFail({ where: { id }, relations: { sender: true, resolvedBy: true } });
  }

  /**
   * Views for a batch of messages of one group, as seen by `viewerId`: read counts from the
   * members' read markers, plus ack summaries for alerts. Counts only include *current*
   * members other than the sender.
   */
  async buildViews(groupId: string, messages: Message[], viewerId: string): Promise<MessageView[]> {
    if (!messages.length) return [];
    const alertIds = messages.filter((m) => requiresAck(m.type)).map((m) => m.id);
    const replyIds = [...new Set(messages.map((m) => m.replyToId).filter((id): id is string => !!id))];
    const [memberIds, markers, acks, replyTargets] = await Promise.all([
      this.realtime.groupMemberIds(groupId),
      this.reads.find({ where: { groupId }, select: { userId: true, lastReadAt: true } }),
      alertIds.length ? this.acks.find({ where: { messageId: In(alertIds) }, select: { messageId: true, userId: true } }) : [],
      replyIds.length ? this.messages.find({ where: { id: In(replyIds) }, relations: { sender: true } }) : [],
    ]);
    const replies = new Map(replyTargets.map((t) => [t.id, replyPreview(t)]));
    const members = new Set(memberIds);
    const readUpTo = markers.map((r) => ({ userId: r.userId, at: r.lastReadAt.getTime() }));
    const ackedBy = new Map<string, Set<string>>();
    for (const a of acks) {
      if (!ackedBy.has(a.messageId)) ackedBy.set(a.messageId, new Set());
      ackedBy.get(a.messageId)!.add(a.userId);
    }

    return messages.map((m) => {
      const audience = memberIds.filter((id) => id !== m.senderId);
      const view: MessageView = {
        id: m.id,
        groupId: m.groupId,
        type: m.type,
        kind: m.kind,
        category: m.category,
        body: m.body,
        clientMsgId: m.clientMsgId,
        sender: userSummary(m.sender),
        location: m.location,
        voice: m.voiceKey && m.voiceContentType ? { durationMs: m.voiceDurationMs ?? 0, contentType: m.voiceContentType } : null,
        replyTo: (m.replyToId && replies.get(m.replyToId)) || null,
        forwarded: m.forwarded,
        deletedAt: m.deletedAt,
        createdAt: m.createdAt,
        readByCount: readUpTo.filter((r) => r.userId !== m.senderId && members.has(r.userId) && r.at >= m.createdAt.getTime())
          .length,
      };
      if (isAlert(m.type)) {
        const acked = ackedBy.get(m.id) ?? new Set<string>();
        const ackCount = audience.filter((id) => acked.has(id)).length;
        view.alert = {
          requiresAck: requiresAck(m.type),
          active: requiresAck(m.type) && !m.resolvedAt,
          ackCount,
          pendingCount: requiresAck(m.type) ? audience.length - ackCount : 0,
          acknowledgedByMe: acked.has(viewerId),
          resolvedAt: m.resolvedAt,
          resolvedBy: m.resolvedBy ? userSummary(m.resolvedBy) : null,
        };
      }
      return view;
    });
  }

  async groupName(groupId: string): Promise<string> {
    const group = await this.groups.findOne({ where: { id: groupId }, select: { id: true, name: true } });
    return group?.name ?? 'Your group';
  }

  // --- internals ---

  /** Checks a reply's target: a message in the same group that hasn't been deleted. */
  private async replyTarget(groupId: string, replyToMessageId?: string): Promise<string | null> {
    if (!replyToMessageId) return null;
    const target = await this.messages.findOne({ where: { id: replyToMessageId, groupId }, select: { id: true, deletedAt: true } });
    if (!target) throw new BadRequestException('replyToMessageId must be a message in this group');
    if (target.deletedAt) throw new BadRequestException("That message was deleted, so it can't be replied to");
    return target.id;
  }

  private findByClientMsgId(senderId: string, clientMsgId: string) {
    return this.messages.findOne({ where: { senderId, clientMsgId }, relations: { sender: true, resolvedBy: true } });
  }

  private async existingForResend(existing: Message, groupId: string, userId: string): Promise<MessageView> {
    if (existing.groupId !== groupId) throw new ConflictException('clientMsgId was already used for a message in another group');
    return (await this.buildViews(groupId, [existing], userId))[0];
  }

  /** Forward-only upsert of the member's read marker; broadcasts `chat:read` when it moves. */
  private async advanceReadMarker(groupId: string, userId: string, message: Message): Promise<void> {
    const rows: unknown[] = await this.reads.query(
      `INSERT INTO message_reads (group_id, user_id, last_read_message_id, last_read_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, user_id) DO UPDATE
         SET last_read_message_id = EXCLUDED.last_read_message_id, last_read_at = EXCLUDED.last_read_at
         WHERE message_reads.last_read_at < EXCLUDED.last_read_at
       RETURNING user_id`,
      [groupId, userId, message.id, message.createdAt],
    );
    if (!rows.length) return;
    await this.realtime.emitToGroup(groupId, ChatEvents.READ, {
      groupId,
      userId,
      lastReadMessageId: message.id,
      lastReadAt: message.createdAt,
    });
  }

  private async pushToOfflineMembers(view: MessageView): Promise<void> {
    const others = (await this.realtime.groupMemberIds(view.groupId)).filter((id) => id !== view.sender.userId);
    const online = await this.realtime.onlineUserIds(others);
    const offline = others.filter((id) => !online.has(id));
    if (!offline.length) return;
    await this.push.sendToUsers(offline, {
      title: await this.groupName(view.groupId),
      body: truncate(`${view.sender.name}: ${pushPreview(view)}`, PUSH_PREVIEW_LENGTH),
      data: { type: 'CHAT_MESSAGE', groupId: view.groupId, messageId: view.id },
    });
  }
}

function replyPreview(m: Message): ReplyPreview {
  const text = m.kind === MessageKind.LOCATION ? m.location?.label || m.body : m.body;
  return {
    id: m.id,
    sender: userSummary(m.sender),
    type: m.type,
    kind: m.kind,
    preview: m.deletedAt ? '' : truncate(text, REPLY_PREVIEW_LENGTH),
    deleted: !!m.deletedAt,
  };
}

function pushPreview(view: MessageView): string {
  if (view.kind === MessageKind.VOICE) return '🎤 Voice message';
  if (view.kind === MessageKind.LOCATION) {
    const place = view.location?.label ? ` ${view.location.label}` : '';
    return `📍 Location${place}${view.body ? `: ${view.body}` : ''}`;
  }
  return view.body;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505';
}
