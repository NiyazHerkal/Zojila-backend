import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupMember } from '../database/entities/index.js';
import { SocketServerRef, userRoom, type SocketData } from './socket-server.ref.js';

/**
 * Pushes events to connected apps. Used by status (Phase 9), location (7) and chat/SOS (8).
 *
 * Single-instance for now. When the API runs on several servers, add the socket.io Redis
 * adapter (`@socket.io/redis-adapter`) in main.ts; this API stays the same (`fetchSockets`
 * also works across servers with the adapter).
 */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly ref: SocketServerRef,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
  ) {}

  /**
   * Sends to every current member of the group, looked up at send time, so removed members
   * stop receiving at once. `exceptUserId` skips one member (e.g. the person typing).
   */
  async emitToGroup(groupId: string, event: string, payload: unknown, opts: { exceptUserId?: string } = {}): Promise<void> {
    if (!this.ref.server) return;
    const ids = (await this.groupMemberIds(groupId)).filter((id) => id !== opts.exceptUserId);
    this.emitToUsers(ids, event, payload);
  }

  /** Closes every socket of a user (e.g. after they delete their account). */
  disconnectUser(userId: string): void {
    this.ref.server?.in(userRoom(userId)).disconnectSockets(true);
  }

  /** Sends to one user's connected devices. */
  async emitToUser(userId: string, event: string, payload: unknown): Promise<void> {
    this.ref.server?.to(userRoom(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.ref.server || !userIds.length) return;
    this.ref.server.to(userIds.map(userRoom)).emit(event, payload);
  }

  async groupMemberIds(groupId: string): Promise<string[]> {
    const members = await this.members.find({ where: { groupId }, select: { userId: true } });
    return members.map((m) => m.userId);
  }

  /** Everyone who shares at least one group with the user (not the user themself). */
  async coMemberIds(userId: string): Promise<string[]> {
    const rows = await this.members
      .createQueryBuilder('mine')
      .innerJoin(GroupMember, 'other', 'other.group_id = mine.group_id AND other.user_id <> mine.user_id')
      .select('DISTINCT other.user_id', 'userId')
      .where('mine.user_id = :userId', { userId })
      .getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  /** How many sockets (devices) the user has connected right now. */
  async socketCount(userId: string): Promise<number> {
    if (!this.ref.server) return 0;
    return (await this.ref.server.in(userRoom(userId)).fetchSockets()).length;
  }

  /** Which of these users have at least one connected socket right now. */
  async onlineUserIds(userIds: string[]): Promise<Set<string>> {
    if (!this.ref.server || !userIds.length) return new Set();
    const sockets = await this.ref.server.in(userIds.map(userRoom)).fetchSockets();
    return new Set(sockets.map((s) => (s.data as SocketData).userId));
  }
}
