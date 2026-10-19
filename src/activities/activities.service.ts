import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  ActivityProgress,
  ActivityStatus,
  ActivityUpdate,
  Group,
  type GroupMember,
  GroupRole,
  Itinerary,
  ItineraryStatus,
  type User,
  Waypoint,
} from '../database/entities/index.js';
import { ItineraryService } from '../itinerary/itinerary.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { CreateActivityUpdateDto, ListActivityUpdatesQueryDto } from './dto/activity.dto.js';

/** Socket events to the group (names from change request v1.0, §15). */
export const ACTIVITY_EVENTS = {
  STATUS_UPDATED: 'activity:status_updated',
  UPDATE_ADDED: 'activity:update_added',
  UPDATE_EDITED: 'activity:update_edited',
  UPDATE_DELETED: 'activity:update_deleted',
} as const;

const DEFAULT_LIST_LIMIT = 50;

interface Person {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export interface ActivityUpdateView {
  id: string;
  groupId: string;
  activityId: string;
  author: Person;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Activities = the stops of the group's finalized itinerary (change request v1.0, changes 3–4).
 * Each has a status (UPCOMING → CURRENT → COMPLETED, admins set it, one CURRENT at a time) and a
 * feed of text updates any member can post. Both are keyed by the stop's `activityId` (the
 * waypoint's stop_key), which stays the same across itinerary versions.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(ActivityProgress) private readonly progress: Repository<ActivityProgress>,
    @InjectRepository(ActivityUpdate) private readonly updates: Repository<ActivityUpdate>,
    @InjectRepository(Itinerary) private readonly itineraries: Repository<Itinerary>,
    @InjectRepository(Waypoint) private readonly waypoints: Repository<Waypoint>,
    private readonly dataSource: DataSource,
    private readonly itinerary: ItineraryService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------- status

  /** The latest finalized itinerary's stops with their status (404 if nothing is finalized). */
  async list(groupId: string) {
    const latest = await this.itinerary.getLatest(groupId);
    return {
      itineraryVersion: latest.version,
      activities: latest.waypoints.map((w) => ({
        activityId: w.activityId,
        waypointId: w.id,
        position: w.position,
        role: w.role,
        name: w.name,
        date: w.date,
        ...w.activity,
      })),
    };
  }

  /**
   * Admins move a stop between UPCOMING / CURRENT / COMPLETED. Making one CURRENT completes the
   * stop that was CURRENT before, so the group is only ever "at" one place. Setting the status it
   * already has changes nothing.
   */
  async setStatus(groupId: string, actor: GroupMember, activityId: string, status: ActivityStatus) {
    await this.currentStop(groupId, activityId);
    const changed: { activityId: string; status: ActivityStatus }[] = [];
    await this.dataSource.transaction(async (manager) => {
      // One status change per group at a time, so two admins can't both make a stop CURRENT.
      await manager.findOne(Group, { where: { id: groupId }, lock: { mode: 'pessimistic_write' } });
      const row = await manager.findOne(ActivityProgress, { where: { groupId, stopKey: activityId } });
      if ((row?.status ?? ActivityStatus.UPCOMING) === status) return;

      if (status === ActivityStatus.CURRENT) {
        const current = await manager.find(ActivityProgress, { where: { groupId, status: ActivityStatus.CURRENT } });
        for (const other of current) {
          other.status = ActivityStatus.COMPLETED;
          other.updatedById = actor.userId;
          await manager.save(other);
          changed.push({ activityId: other.stopKey, status: other.status });
        }
      }
      await manager.save(manager.create(ActivityProgress, { groupId, stopKey: activityId, status, updatedById: actor.userId }));
      changed.push({ activityId, status });
    });

    const timestamp = new Date();
    for (const change of changed) {
      await this.realtime.emitToGroup(groupId, ACTIVITY_EVENTS.STATUS_UPDATED, {
        groupId,
        ...change,
        updatedBy: actor.userId,
        timestamp,
      });
    }
    const all = await this.list(groupId);
    return all.activities.find((a) => a.activityId === activityId)!;
  }

  // ---------------------------------------------------------------- updates

  /** Newest first, paged with `before`. Deleted updates are left out. */
  async listUpdates(groupId: string, actor: GroupMember, activityId: string, query: ListActivityUpdatesQueryDto) {
    await this.knownStop(groupId, activityId);
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const qb = this.updates
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.user', 'user')
      .where('u.group_id = :groupId AND u.stop_key = :activityId AND u.deleted_at IS NULL', { groupId, activityId })
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .take(limit + 1); // one extra row tells us whether another page exists
    if (query.before) {
      const cursor = await this.updates.findOne({ where: { id: query.before, groupId, stopKey: activityId } });
      if (!cursor) throw new BadRequestException('before must be an update id from this activity');
      qb.andWhere('(u.created_at, u.id) < (:cAt, :cId)', { cAt: cursor.createdAt, cId: cursor.id });
    }
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return {
      items: page.map((u) => this.toView(u, actor)),
      nextBefore: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** The group's latest updates across all activities, newest first (for the offline bundle). */
  async recentUpdates(groupId: string, actor: GroupMember, limit: number): Promise<ActivityUpdateView[]> {
    const rows = await this.updates.find({
      where: { groupId, deletedAt: IsNull() },
      relations: { user: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    return rows.map((u) => this.toView(u, actor));
  }

  async addUpdate(groupId: string, actor: GroupMember, activityId: string, dto: CreateActivityUpdateDto) {
    if (dto.clientId) {
      const existing = await this.findByClientId(actor.userId, dto.clientId);
      if (existing) return this.toView(existing, actor); // a retry: no second event
    }
    await this.currentStop(groupId, activityId);

    let saved: ActivityUpdate;
    try {
      saved = await this.updates.save(
        this.updates.create({ groupId, stopKey: activityId, userId: actor.userId, text: dto.text, clientId: dto.clientId ?? null }),
      );
    } catch (err) {
      const existing = dto.clientId && isUniqueViolation(err) ? await this.findByClientId(actor.userId, dto.clientId) : null;
      if (existing) return this.toView(existing, actor);
      throw err;
    }
    const update = await this.updates.findOneOrFail({ where: { id: saved.id }, relations: { user: true } });
    await this.announce(groupId, ACTIVITY_EVENTS.UPDATE_ADDED, update);
    return this.toView(update, actor);
  }

  /** Only the author can change the text. */
  async editUpdate(groupId: string, actor: GroupMember, updateId: string, text: string) {
    const update = await this.findUpdate(groupId, updateId);
    if (update.userId !== actor.userId) throw new ForbiddenException('Only the author can edit an update');
    update.text = text;
    update.editedAt = new Date();
    await this.updates.save(update);
    await this.announce(groupId, ACTIVITY_EVENTS.UPDATE_EDITED, update);
    return this.toView(update, actor);
  }

  /**
   * The author or an admin deletes it. The row stays (deleted_at) so every phone can drop it in
   * the same way, but the text is wiped.
   */
  async deleteUpdate(groupId: string, actor: GroupMember, updateId: string): Promise<void> {
    const update = await this.findUpdate(groupId, updateId);
    if (update.userId !== actor.userId && actor.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Only the author or an admin can delete an update');
    }
    const deletedAt = new Date();
    await this.updates.update({ id: update.id }, { deletedAt, deletedById: actor.userId, text: '' });
    await this.realtime.emitToGroup(groupId, ACTIVITY_EVENTS.UPDATE_DELETED, {
      groupId,
      activityId: update.stopKey,
      updateId: update.id,
      deletedBy: actor.userId,
      timestamp: deletedAt,
    });
  }

  // ---------------------------------------------------------------- helpers

  /** The stop must be in the latest finalized itinerary to get a status or new updates. */
  private async currentStop(groupId: string, activityId: string): Promise<Waypoint> {
    const latest = await this.itineraries.findOne({
      where: { groupId, status: ItineraryStatus.LOCKED },
      order: { version: 'DESC' },
    });
    if (!latest) throw new NotFoundException('No finalized itinerary yet');
    const stop = await this.waypoints.findOne({ where: { itineraryId: latest.id, stopKey: activityId } });
    if (!stop) throw new NotFoundException('Activity not found in the current itinerary');
    return stop;
  }

  /** Reading is allowed for any stop the group ever had (e.g. one removed in a later version). */
  private async knownStop(groupId: string, activityId: string): Promise<void> {
    const exists = await this.waypoints
      .createQueryBuilder('w')
      .innerJoin('w.itinerary', 'i')
      .where('i.group_id = :groupId AND w.stop_key = :activityId', { groupId, activityId })
      .getExists();
    if (!exists) throw new NotFoundException('Activity not found');
  }

  private async findUpdate(groupId: string, updateId: string): Promise<ActivityUpdate> {
    const update = await this.updates.findOne({
      where: { id: updateId, groupId, deletedAt: IsNull() },
      relations: { user: true },
    });
    if (!update) throw new NotFoundException('Update not found');
    return update;
  }

  private findByClientId(userId: string, clientId: string): Promise<ActivityUpdate | null> {
    return this.updates.findOne({ where: { userId, clientId, deletedAt: IsNull() }, relations: { user: true } });
  }

  /** The broadcast leaves out the per-person `canEdit` / `canDelete`. */
  private async announce(groupId: string, event: string, update: ActivityUpdate) {
    const { canEdit: _canEdit, canDelete: _canDelete, ...view } = this.toView(update, null);
    await this.realtime.emitToGroup(groupId, event, {
      groupId,
      activityId: update.stopKey,
      updateId: update.id,
      update: view,
      timestamp: update.editedAt ?? update.createdAt,
    });
  }

  private toView(u: ActivityUpdate, actor: GroupMember | null): ActivityUpdateView {
    return {
      id: u.id,
      groupId: u.groupId,
      activityId: u.stopKey,
      author: person(u.user),
      text: u.text,
      createdAt: u.createdAt,
      editedAt: u.editedAt,
      canEdit: actor?.userId === u.userId,
      canDelete: actor?.userId === u.userId || actor?.role === GroupRole.ADMIN,
    };
  }
}

function person(user: User): Person {
  return { userId: user.id, username: user.username, name: user.name, avatarUrl: user.avatarUrl };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505';
}
