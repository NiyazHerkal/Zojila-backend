import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  ActivityAttendance,
  ActivityProgress,
  ActivityStatus,
  ActivityUpdate,
  Group,
  GroupMember,
  GroupRole,
  Itinerary,
  ItineraryStatus,
  type User,
  Waypoint,
} from '../database/entities/index.js';
import { distanceMeters } from '../enrichment/geo.js';
import { ItineraryService } from '../itinerary/itinerary.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { ArrivalCheckDto, CreateActivityUpdateDto, ListActivityUpdatesQueryDto } from './dto/activity.dto.js';

/** Socket events to the group (names from change request v1.0, §15). */
export const ACTIVITY_EVENTS = {
  STATUS_UPDATED: 'activity:status_updated',
  UPDATE_ADDED: 'activity:update_added',
  UPDATE_EDITED: 'activity:update_edited',
  UPDATE_DELETED: 'activity:update_deleted',
  ATTENDANCE_UPDATED: 'activity:attendance_updated', // backend handover 2026-10-22, P-03
} as const;

const DEFAULT_LIST_LIMIT = 50;

/**
 * Arrival suggestion rules (backend handover 2026-10-22, P-04). Proposed defaults, not yet
 * signed off by product: within 200 m of the stop, with a fix accurate to 100 m, at most 2 min old.
 */
export const ARRIVAL = {
  radiusMeters: 200,
  maxAccuracyMeters: 100,
  maxAgeMs: 2 * 60_000,
} as const;

export type ArrivalRefusal = 'ACCURACY_TOO_LOW' | 'POSITION_TOO_OLD' | 'TOO_FAR';

interface Person {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export interface AttendanceView {
  activityId: string;
  arrivedCount: number;
  totalMembers: number;
  members: (Person & { arrived: boolean; arrivedAt: Date | null })[];
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
    @InjectRepository(ActivityAttendance) private readonly attendanceRows: Repository<ActivityAttendance>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    private readonly dataSource: DataSource,
    private readonly itinerary: ItineraryService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------- status

  /** The latest finalized itinerary's stops with their status (404 if nothing is finalized). */
  async list(groupId: string) {
    const latest = await this.itinerary.getLatest(groupId);
    const [arrived, totalMembers] = await Promise.all([
      this.arrivedCounts(groupId),
      this.members.countBy({ groupId }),
    ]);
    return {
      itineraryVersion: latest.version,
      activities: latest.waypoints.map((w) => ({
        activityId: w.activityId,
        waypointId: w.id,
        position: w.position,
        role: w.role,
        name: w.name,
        date: w.date,
        startTime: w.startTime,
        endTime: w.endTime,
        ...w.activity,
        arrivedCount: arrived.get(w.activityId) ?? 0,
        totalMembers,
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

  // ---------------------------------------------------------------- attendance

  /** Who has arrived at a stop. Any stop the group ever had can be read; counts cover current members. */
  async attendance(groupId: string, activityId: string): Promise<AttendanceView> {
    await this.knownStop(groupId, activityId);
    const [members, rows] = await Promise.all([
      this.members.find({ where: { groupId }, relations: { user: true }, order: { joinedAt: 'ASC' } }),
      this.attendanceRows.find({ where: { groupId, stopKey: activityId } }),
    ]);
    const arrivedAt = new Map(rows.map((r) => [r.userId, r.arrivedAt]));
    const list = members.map((m) => ({
      ...person(m.user),
      arrived: arrivedAt.has(m.userId),
      arrivedAt: arrivedAt.get(m.userId) ?? null,
    }));
    return {
      activityId,
      arrivedCount: list.filter((m) => m.arrived).length,
      totalMembers: list.length,
      members: list,
    };
  }

  /**
   * A member marks only themselves as arrived (or undoes it); who comes from the token, never the
   * body. The stop must be in the current itinerary. Sending the state it already has changes
   * nothing and sends no event, so retries are safe.
   */
  async setMyAttendance(groupId: string, actor: GroupMember, activityId: string, arrived: boolean) {
    await this.currentStop(groupId, activityId);
    const key = { groupId, stopKey: activityId, userId: actor.userId };
    let changed: boolean;
    if (arrived) {
      const inserted = await this.attendanceRows
        .createQueryBuilder()
        .insert()
        .values(key)
        .orIgnore()
        .returning(['arrived_at'])
        .execute();
      changed = (inserted.raw as unknown[]).length > 0;
    } else {
      changed = ((await this.attendanceRows.delete(key)).affected ?? 0) > 0;
    }

    const view = await this.attendance(groupId, activityId);
    if (changed) {
      await this.realtime.emitToGroup(groupId, ACTIVITY_EVENTS.ATTENDANCE_UPDATED, {
        groupId,
        activityId,
        userId: actor.userId,
        arrived,
        arrivedAt: view.members.find((m) => m.userId === actor.userId)?.arrivedAt ?? null,
        arrivedCount: view.arrivedCount,
        totalMembers: view.totalMembers,
        timestamp: new Date(),
      });
    }
    return view;
  }

  /**
   * Is this position close enough to the stop to suggest "You've arrived"? Only a suggestion:
   * it never records anything; the member confirms with PUT …/attendance/me. A fix that is too
   * vague or too old is refused with a reason rather than guessed at.
   */
  async arrivalCheck(groupId: string, actor: GroupMember, activityId: string, dto: ArrivalCheckDto) {
    const stop = await this.currentStop(groupId, activityId);
    const distance = Math.round(distanceMeters(dto.lat, dto.lng, stop.lat, stop.lng));
    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();
    const ageMs = Date.now() - recordedAt.getTime(); // negative (clock skew) counts as fresh
    const withinRadius = distance <= ARRIVAL.radiusMeters;

    let reason: ArrivalRefusal | null = null;
    if (dto.accuracy > ARRIVAL.maxAccuracyMeters) reason = 'ACCURACY_TOO_LOW';
    else if (ageMs > ARRIVAL.maxAgeMs) reason = 'POSITION_TOO_OLD';
    else if (!withinRadius) reason = 'TOO_FAR';

    const alreadyArrived = await this.attendanceRows.existsBy({ groupId, stopKey: activityId, userId: actor.userId });
    return {
      activityId,
      withinRadius,
      distanceMeters: distance,
      radiusMeters: ARRIVAL.radiusMeters,
      accepted: reason === null,
      reason,
      alreadyArrived,
    };
  }

  /** Arrived count per stop, current members only (for the activities list). */
  private async arrivedCounts(groupId: string): Promise<Map<string, number>> {
    const rows = await this.attendanceRows
      .createQueryBuilder('a')
      .innerJoin(GroupMember, 'm', 'm.group_id = a.group_id AND m.user_id = a.user_id')
      .select('a.stop_key', 'stopKey')
      .addSelect('COUNT(*)::int', 'count')
      .where('a.group_id = :groupId', { groupId })
      .groupBy('a.stop_key')
      .getRawMany<{ stopKey: string; count: number }>();
    return new Map(rows.map((r) => [r.stopKey, r.count]));
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
