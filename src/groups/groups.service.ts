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
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { Expense, ExpenseSettlement, Group, GroupMember, GroupRole, LocationShare, User } from '../database/entities/index.js';
import { PushService } from '../notifications/push.service.js';
import { StorageService } from '../storage/storage.service.js';
import { IMAGE_MAX_BYTES, detectImageType } from '../storage/image-file.js';
import { publicApiUrl } from '../storage/public-url.js';
import type { AddMemberDto } from './dto/add-member.dto.js';
import type { CreateGroupDto } from './dto/create-group.dto.js';
import type { UpdateGroupDto } from './dto/update-group.dto.js';
import { GroupEventsService, memberView } from './group-events.service.js';

export interface GroupView {
  id: string;
  name: string;
  description: string;
  tripStart: Date;
  tripEnd: Date;
  currency: string;
  createdById: string;
  createdAt: Date;
  closedAt: Date | null;
  deleteAfter: Date | null;
  /** Fetch with the usual Bearer token (members only). `?v=` changes on every new upload. */
  coverImageUrl: string | null;
  myRole: GroupRole;
  memberCount: number;
}

export interface UploadedCoverImage {
  buffer: Buffer;
  size: number;
}

const DEFAULT_DELETE_AFTER_CLOSE_DAYS = 30;

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);
  private readonly deleteAfterCloseDays: number;
  private readonly publicApiUrl: string;

  constructor(
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly push: PushService,
    private readonly events: GroupEventsService,
    config: ConfigService,
  ) {
    const days = Number(config.get<string>('GROUP_DELETE_AFTER_CLOSE_DAYS'));
    this.deleteAfterCloseDays = days > 0 ? days : DEFAULT_DELETE_AFTER_CLOSE_DAYS;
    this.publicApiUrl = publicApiUrl(config);
  }

  async create(userId: string, dto: CreateGroupDto): Promise<GroupView> {
    const tripStart = new Date(dto.tripStart);
    const tripEnd = new Date(dto.tripEnd);
    this.assertTripDates(tripStart, tripEnd);

    return this.dataSource.transaction(async (manager) => {
      const group = await manager.save(
        manager.create(Group, {
          name: dto.name,
          description: dto.description,
          tripStart,
          tripEnd,
          currency: dto.currency ?? 'INR',
          createdById: userId,
        }),
      );
      await manager.save(manager.create(GroupMember, { groupId: group.id, userId, role: GroupRole.ADMIN }));
      return this.toView(group, GroupRole.ADMIN, 1);
    });
  }

  async listMine(userId: string): Promise<GroupView[]> {
    const memberships = await this.members.find({
      where: { userId },
      relations: { group: true },
      order: { group: { tripStart: 'ASC' } },
    });
    const counts = await this.memberCounts(memberships.map((m) => m.groupId));
    return memberships.map((m) => this.toView(m.group, m.role, counts.get(m.groupId) ?? 0));
  }

  async findOne(groupId: string, membership: GroupMember): Promise<GroupView> {
    const group = await this.groups.findOneByOrFail({ id: groupId });
    const counts = await this.memberCounts([groupId]);
    return this.toView(group, membership.role, counts.get(groupId) ?? 0);
  }

  async update(groupId: string, membership: GroupMember, dto: UpdateGroupDto): Promise<GroupView> {
    const group = await this.groups.findOneByOrFail({ id: groupId });
    if (dto.name !== undefined) group.name = dto.name;
    if (dto.description !== undefined) group.description = dto.description;
    if (dto.tripStart !== undefined) group.tripStart = new Date(dto.tripStart);
    if (dto.tripEnd !== undefined) group.tripEnd = new Date(dto.tripEnd);
    this.assertTripDates(group.tripStart, group.tripEnd);
    if (dto.currency !== undefined && dto.currency !== group.currency) {
      // Amounts are stored without conversion, so the currency is fixed once money is recorded.
      const hasMoney =
        (await this.dataSource.getRepository(Expense).existsBy({ groupId })) ||
        (await this.dataSource.getRepository(ExpenseSettlement).existsBy({ groupId }));
      if (hasMoney) throw new ConflictException("The currency can't change once the group has expenses");
      group.currency = dto.currency;
    }

    await this.groups.save(group);
    return this.changed(groupId, membership);
  }

  /**
   * Closes the trip (PDF §4 "group data deletion on group closure"): read-only from now on, and
   * deleted for good after GROUP_DELETE_AFTER_CLOSE_DAYS (default 30) by the retention job. Members
   * are told by push so they can download the expense report first. Closing twice changes nothing.
   */
  async close(groupId: string, membership: GroupMember): Promise<GroupView> {
    const group = await this.groups.findOneByOrFail({ id: groupId });
    if (!group.closedAt) {
      const closedAt = new Date();
      const deleteAfter = new Date(closedAt.getTime() + this.deleteAfterCloseDays * 24 * 60 * 60 * 1000);
      await this.groups.update({ id: groupId }, { closedAt, deleteAfter });
      this.pushClosed(groupId, group.name, membership.userId, deleteAfter).catch((err: Error) =>
        this.logger.warn(`Trip-closed push failed: ${err.message}`),
      );
      return this.changed(groupId, membership);
    }
    return this.findOne(groupId, membership);
  }

  /** Reopens a closed trip before it's deleted. */
  async reopen(groupId: string, membership: GroupMember): Promise<GroupView> {
    const result = await this.groups.update({ id: groupId, closedAt: Not(IsNull()) }, { closedAt: null, deleteAfter: null });
    return result.affected ? this.changed(groupId, membership) : this.findOne(groupId, membership);
  }

  private async pushClosed(groupId: string, name: string, actorId: string, deleteAfter: Date): Promise<void> {
    const [members, actor] = await Promise.all([
      this.members.find({ where: { groupId }, select: { userId: true } }),
      this.users.findOne({ where: { id: actorId }, select: { id: true, name: true } }),
    ]);
    const day = deleteAfter.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    await this.push.sendToUsers(
      members.map((m) => m.userId).filter((id) => id !== actorId),
      {
        title: `${name}: trip closed`,
        body: `${actor?.name ?? 'An admin'} closed this trip. It will be deleted on ${day}. Download the expense report before then.`,
        data: { type: 'GROUP_CLOSED', groupId, deleteAfter: deleteAfter.toISOString() },
      },
    );
  }

  async remove(groupId: string): Promise<void> {
    await this.groups.delete({ id: groupId });
    // The rows cascade, the files don't.
    await this.storage.deletePrefix(`receipts/${groupId}`);
    await this.storage.deletePrefix(`voice/${groupId}`);
    await this.storage.deletePrefix(`groups/${groupId}`);
  }

  // ---------------------------------------------------------------- cover image

  /** Sets or replaces the trip's cover image (JPEG/PNG/WebP, max 5 MB). */
  async putCoverImage(groupId: string, membership: GroupMember, file: UploadedCoverImage | undefined): Promise<GroupView> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the image as multipart field "file"');
    if (file.size > IMAGE_MAX_BYTES) throw new PayloadTooLargeException('Cover image must be 5 MB or smaller');
    const type = detectImageType(file.buffer);
    if (!type) throw new UnsupportedMediaTypeException('Cover image must be a JPEG, PNG or WebP');

    const group = await this.groups.findOneByOrFail({ id: groupId });
    const key = `groups/${groupId}/cover/${randomUUID()}.${type.extension}`;
    await this.storage.put(key, file.buffer, type.contentType);
    await this.groups.update({ id: groupId }, { coverImageKey: key, coverImageContentType: type.contentType });
    // The row points at the new file before the old one goes, so it's never left dangling.
    if (group.coverImageKey) await this.storage.delete(group.coverImageKey);
    return this.changed(groupId, membership);
  }

  async getCoverImage(groupId: string): Promise<{ data: Buffer; contentType: string }> {
    const group = await this.groups.findOneByOrFail({ id: groupId });
    if (!group.coverImageKey || !group.coverImageContentType) throw new NotFoundException('This trip has no cover image');
    const data = await this.storage.get(group.coverImageKey);
    if (!data) throw new NotFoundException('Cover image file is missing');
    return { data, contentType: group.coverImageContentType };
  }

  /** Removes the cover image. Nothing to do if there isn't one. */
  async deleteCoverImage(groupId: string, membership: GroupMember): Promise<GroupView> {
    const group = await this.groups.findOneByOrFail({ id: groupId });
    if (group.coverImageKey) {
      await this.groups.update({ id: groupId }, { coverImageKey: null, coverImageContentType: null });
      await this.storage.delete(group.coverImageKey);
      return this.changed(groupId, membership);
    }
    return this.findOne(groupId, membership);
  }

  private coverImageUrl(group: Group): string | null {
    if (!group.coverImageKey) return null;
    // The file's uuid doubles as a cache-busting version, so a new upload gets a new URL.
    const version = group.coverImageKey.split('/').pop()!.split('.')[0];
    return `${this.publicApiUrl}/groups/${group.id}/cover-image?v=${version}`;
  }

  async listMembers(groupId: string) {
    const members = await this.members.find({
      where: { groupId },
      relations: { user: true },
      order: { role: 'ASC', joinedAt: 'ASC' },
    });
    return members.map((m) => memberView(m));
  }

  /** PDF §2.2: add an already-registered (verified) user directly, no invite round-trip. */
  async addMember(groupId: string, actorId: string, dto: AddMemberDto) {
    const user = await this.users.findOne({ where: this.registeredUserWhere(dto) });
    if (!user) throw new NotFoundException('No registered TravelGo user with that username/email/phone');

    const existing = await this.members.findOne({ where: { groupId, userId: user.id } });
    if (existing) throw new ConflictException('User is already a member of this group');

    const member = await this.members.save(
      this.members.create({ groupId, userId: user.id, role: dto.role ?? GroupRole.VIEWER }),
    );
    member.user = user;
    await this.events.memberJoined(groupId, user.id, 'DIRECT', actorId);
    return memberView(member);
  }

  async updateMemberRole(groupId: string, actorId: string, targetUserId: string, role: GroupRole) {
    let changed = false;
    const view = await this.dataSource.transaction(async (manager) => {
      await this.lockGroup(manager, groupId);
      const member = await manager.findOne(GroupMember, {
        where: { groupId, userId: targetUserId },
        relations: { user: true },
      });
      if (!member) throw new NotFoundException('Member not found');

      if (member.role === GroupRole.ADMIN && role !== GroupRole.ADMIN) {
        await this.assertNotLastAdmin(manager, groupId);
      }
      changed = member.role !== role;
      member.role = role;
      await manager.save(member);
      return memberView(member);
    });
    if (changed) await this.events.roleChanged(groupId, targetUserId, role, actorId);
    return view;
  }

  /** Admins can remove anyone; any member can remove themselves (leave the group). */
  async removeMember(groupId: string, actor: GroupMember, targetUserId: string): Promise<void> {
    if (actor.userId !== targetUserId && actor.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Only a group admin can remove other members');
    }

    const wasSharing = await this.dataSource.transaction(async (manager) => {
      await this.lockGroup(manager, groupId);
      const member = await manager.findOne(GroupMember, { where: { groupId, userId: targetUserId } });
      if (!member) throw new NotFoundException('Member not found');

      if (member.role === GroupRole.ADMIN) await this.assertNotLastAdmin(manager, groupId);
      const sharing = await manager.existsBy(LocationShare, { groupId, userId: targetUserId });
      await manager.delete(GroupMember, { groupId, userId: targetUserId }); // ends their sharing (FK cascade)
      return sharing;
    });
    await this.events.memberRemoved(groupId, targetUserId, actor.userId, wasSharing);
  }

  // --- internals ---

  /** The fresh group for the caller, after telling every member's app it changed (`group:updated`). */
  private async changed(groupId: string, membership: GroupMember): Promise<GroupView> {
    const view = await this.findOne(groupId, membership);
    const { myRole: _myRole, ...group } = view;
    await this.events.groupUpdated(groupId, group, membership.userId);
    return view;
  }

  private registeredUserWhere(dto: AddMemberDto): FindOptionsWhere<User>[] {
    // The DTO validates whichever single field is sent; with two or more it skips them all, so check here.
    if ([dto.username, dto.email, dto.phone].filter((v) => v !== undefined).length !== 1) {
      throw new BadRequestException('Send exactly one of username, email or phone');
    }
    if (dto.username) {
      return [
        { username: dto.username, emailVerified: true },
        { username: dto.username, phoneVerified: true },
      ];
    }
    if (dto.email) return [{ email: dto.email, emailVerified: true }];
    return [{ phone: dto.phone, phoneVerified: true }];
  }

  private assertTripDates(tripStart: Date, tripEnd: Date): void {
    if (tripEnd < tripStart) throw new BadRequestException('tripEnd must not be before tripStart');
  }

  // Serializes role changes/removals per group so two concurrent demotions can't both pass
  // the last-admin check.
  private async lockGroup(manager: EntityManager, groupId: string): Promise<void> {
    await manager.findOne(Group, { where: { id: groupId }, lock: { mode: 'pessimistic_write' } });
  }

  private async assertNotLastAdmin(manager: EntityManager, groupId: string): Promise<void> {
    const admins = await manager.count(GroupMember, { where: { groupId, role: GroupRole.ADMIN } });
    if (admins <= 1) {
      throw new ConflictException(
        'A group must keep at least one admin — promote another member first, or delete the group',
      );
    }
  }

  private async memberCounts(groupIds: string[]): Promise<Map<string, number>> {
    if (!groupIds.length) return new Map();
    const rows = await this.members
      .createQueryBuilder('m')
      .select('m.group_id', 'groupId')
      .addSelect('COUNT(*)::int', 'count')
      .where('m.group_id IN (:...groupIds)', { groupIds })
      .groupBy('m.group_id')
      .getRawMany<{ groupId: string; count: number }>();
    return new Map(rows.map((r) => [r.groupId, r.count]));
  }

  private toView(group: Group, myRole: GroupRole, memberCount: number): GroupView {
    const { id, name, description, tripStart, tripEnd, currency, createdById, createdAt, closedAt, deleteAfter } = group;
    return {
      id,
      name,
      description,
      tripStart,
      tripEnd,
      currency,
      createdById,
      createdAt,
      closedAt,
      deleteAfter,
      coverImageUrl: this.coverImageUrl(group),
      myRole,
      memberCount,
    };
  }
}
