import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import {
  GroupMember,
  LocationHistoryConsent,
  LocationHistoryConsentAction,
  LocationHistoryPoint,
} from '../database/entities/index.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';
import { tripClosedError } from '../groups/guards/group-member.guard.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export const LOCATION_HISTORY_CHANGED = 'location:history-changed'; // to group: a member turned history on/off

/** Bump when the notice text changes: members who agreed to an older one are asked again. */
export const LOCATION_HISTORY_NOTICE_VERSION = '2026-10-28';
const DEFAULT_RETENTION_DAYS = 30;
/** Points closer together than this are thinned out (the app sends one every ~10 s). */
const MIN_GAP_MS = 15_000;
const DEFAULT_LIMIT = 1000;
export const MAX_HISTORY_LIMIT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days a saved position is kept (LOCATION_HISTORY_RETENTION_DAYS, default 30). Shared with the retention job. */
export function locationHistoryRetentionDays(config: ConfigService): number {
  const n = Number(config.get<string>('LOCATION_HISTORY_RETENTION_DAYS'));
  return n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

/** A position that passed LocationService's checks; `at` is the clamped fix time in ms. */
export interface AcceptedPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  at: number;
}

export interface HistoryQuery {
  from?: string;
  to?: string;
  after?: string;
  limit?: number;
}

/**
 * Location history (2026-10-28): an opt-in, per-group trail of a member's shared positions.
 *
 *   - Off by default. Turning it on needs the current notice version, so the app must have shown
 *     the notice; every on/off is kept as a consent record.
 *   - Positions are saved only while the member shares live location with the group, history is
 *     on, and the fix is newer than the moment they turned it on. Live sharing is unaffected
 *     either way.
 *   - Turning it off (or leaving the group) deletes the saved trail for that group immediately.
 *   - The retention job deletes positions older than the retention period, and reads never
 *     return older ones even before the job runs.
 *   - Any current member of the group can read the trail of a member who has history on.
 *   - Release switch LOCATION_HISTORY_OPT_IN (default off): until the age-eligibility approach and
 *     the final notice are approved, nobody can turn history on and nothing is saved. Turning it
 *     off, deleting and reading always work.
 */
@Injectable()
export class LocationHistoryService {
  private readonly logger = new Logger(LocationHistoryService.name);
  readonly retentionDays: number;
  /** LOCATION_HISTORY_OPT_IN=true opens opt-in (dev/testing). Not mutable config: tests flip it directly. */
  optInOpen: boolean;

  constructor(
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(LocationHistoryPoint) private readonly points: Repository<LocationHistoryPoint>,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeService,
    config: ConfigService,
  ) {
    this.retentionDays = locationHistoryRetentionDays(config);
    this.optInOpen = config.get<string>('LOCATION_HISTORY_OPT_IN') === 'true';
  }

  /** What the app shows before the member opts in. */
  get notice() {
    return {
      version: LOCATION_HISTORY_NOTICE_VERSION,
      title: 'Save my location history for this trip',
      points: [
        'What is saved: while you share your live location with this trip, your positions (about one every 15 seconds, with accuracy, speed and direction) are saved as a trail.',
        'Why: so you and the trip members can see the route you travelled.',
        'Who can see it: current members of this trip, only while history is on.',
        `How long: each position is deleted automatically ${this.retentionDays} days after it was recorded.`,
        'Turning history off stops saving and deletes your saved trail for this trip straight away. Leaving the trip does the same.',
        'Live location sharing works the same whether history is on or off.',
        'Your saved trail is included when you download your data, and deleted if you delete your account.',
      ],
    };
  }

  async settings(membership: GroupMember) {
    return this.settingsView(membership);
  }

  /** Turn history on (needs the current notice version) or off (deletes the saved trail). */
  async update(membership: GroupMember, enabled: boolean, noticeVersion?: string) {
    const { groupId, userId } = membership;
    if (enabled) {
      if (!this.optInOpen) {
        throw withCode(new ForbiddenException('Location history is not available yet'), ErrorCode.FEATURE_UNAVAILABLE);
      }
      if (noticeVersion !== LOCATION_HISTORY_NOTICE_VERSION) {
        throw withCode(
          new BadRequestException(`Show the current location history notice (version ${LOCATION_HISTORY_NOTICE_VERSION}) and send its version to turn history on`),
          ErrorCode.NOTICE_OUTDATED,
        );
      }
      if (membership.group?.closedAt) throw tripClosedError(); // turning it off always works
      if (membership.locationHistoryEnabled) return this.settingsView(membership);

      const enabledAt = new Date();
      await this.dataSource.transaction(async (manager) => {
        await manager.update(GroupMember, { groupId, userId }, { locationHistoryEnabled: true, locationHistoryEnabledAt: enabledAt });
        await manager.insert(LocationHistoryConsent, { groupId, userId, action: LocationHistoryConsentAction.GRANTED, noticeVersion });
      });
      await this.realtime.emitToGroup(groupId, LOCATION_HISTORY_CHANGED, { groupId, userId, enabled: true });
      return this.settingsView({ ...membership, locationHistoryEnabled: true, locationHistoryEnabledAt: enabledAt });
    }

    if (!membership.locationHistoryEnabled) return { ...this.settingsView(membership), deletedPoints: 0 };
    const deletedPoints = await this.dataSource.transaction(async (manager) => {
      await manager.update(GroupMember, { groupId, userId }, { locationHistoryEnabled: false, locationHistoryEnabledAt: null });
      await manager.insert(LocationHistoryConsent, { groupId, userId, action: LocationHistoryConsentAction.WITHDRAWN, noticeVersion: null });
      const res = await manager.delete(LocationHistoryPoint, { groupId, userId });
      return res.affected ?? 0;
    });
    await this.realtime.emitToGroup(groupId, LOCATION_HISTORY_CHANGED, { groupId, userId, enabled: false });
    return { ...this.settingsView({ ...membership, locationHistoryEnabled: false, locationHistoryEnabledAt: null }), deletedPoints };
  }

  /** Deletes the member's saved trail in this group; history stays on/off as it was. */
  async deleteMine(groupId: string, userId: string) {
    const res = await this.points.delete({ groupId, userId });
    return { deletedPoints: res.affected ?? 0 };
  }

  /**
   * A member's trail in this group, oldest first, paged with `after` = the previous `nextCursor`.
   * Others' trails only while they have history on; your own always (it's empty when off).
   */
  async history(groupId: string, requesterId: string, targetUserId: string, q: HistoryQuery) {
    const target = await this.members.findOne({ where: { groupId, userId: targetUserId }, relations: { user: true } });
    if (!target) throw new NotFoundException('Member not found');

    const now = Date.now();
    const cutoff = now - this.retentionDays * DAY_MS;
    const from = new Date(Math.max(cutoff, q.from ? new Date(q.from).getTime() : cutoff));
    const to = new Date(Math.min(now, q.to ? new Date(q.to).getTime() : now));
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_HISTORY_LIMIT);
    const base = {
      userId: target.userId,
      username: target.user.username,
      name: target.user.name,
      enabled: target.locationHistoryEnabled,
      retentionDays: this.retentionDays,
      from,
      to,
    };
    if (!target.locationHistoryEnabled && targetUserId !== requesterId) return { ...base, points: [], nextCursor: null };
    if (from > to) return { ...base, points: [], nextCursor: null };

    const qb = this.points
      .createQueryBuilder('p')
      .where('p.group_id = :groupId AND p.user_id = :userId', { groupId, userId: targetUserId })
      .andWhere('p.recorded_at >= :from AND p.recorded_at <= :to', { from, to })
      .orderBy('p.recorded_at', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .take(limit + 1);
    const cursor = q.after ? parseCursor(q.after) : null;
    if (cursor) qb.andWhere('(p.recorded_at, p.id) > (:cAt, :cId)', { cAt: new Date(cursor.at), cId: cursor.id });

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      ...base,
      points: page.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy,
        heading: p.heading,
        speed: p.speed,
        recordedAt: p.recordedAt,
      })),
      nextCursor: rows.length > limit ? `${last.recordedAt.getTime()}_${last.id}` : null,
    };
  }

  /** The members of this group who have history on (for the map feed's indicator). */
  async enabledUserIds(groupId: string): Promise<Set<string>> {
    const rows = await this.members.find({ where: { groupId, locationHistoryEnabled: true }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  async isEnabled(groupId: string, userId: string): Promise<boolean> {
    return this.members.existsBy({ groupId, userId, locationHistoryEnabled: true });
  }

  /**
   * Called for every accepted position batch while sharing. Saves the points if the member has
   * history on, thinned to one per MIN_GAP_MS. Never throws: live sharing must keep working.
   */
  async record(groupId: string, userId: string, accepted: AcceptedPoint[]): Promise<number> {
    try {
      const member = await this.members.findOne({
        where: { groupId, userId },
        select: { groupId: true, userId: true, locationHistoryEnabled: true, locationHistoryEnabledAt: true },
      });
      if (!this.optInOpen || !member?.locationHistoryEnabled || !member.locationHistoryEnabledAt) return 0;

      const since = member.locationHistoryEnabledAt.getTime();
      const candidates = accepted.filter((p) => p.at >= since).sort((a, b) => a.at - b.at);
      if (!candidates.length) return 0;

      // Batches can arrive out of order (background queue), so compare with saved points on both sides.
      const nearby = await this.points.find({
        where: {
          groupId,
          userId,
          recordedAt: Between(new Date(candidates[0].at - MIN_GAP_MS), new Date(candidates[candidates.length - 1].at + MIN_GAP_MS)),
        },
        select: { recordedAt: true },
      });
      const kept = nearby.map((p) => p.recordedAt.getTime());
      const rows: Omit<LocationHistoryPoint, 'id' | 'member'>[] = [];
      for (const p of candidates) {
        if (kept.some((t) => Math.abs(t - p.at) < MIN_GAP_MS)) continue;
        kept.push(p.at);
        rows.push({
          groupId,
          userId,
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy ?? null,
          heading: p.heading ?? null,
          speed: p.speed ?? null,
          recordedAt: new Date(p.at),
        });
      }
      if (rows.length) await this.points.insert(rows);
      return rows.length;
    } catch (err) {
      this.logger.warn(`Could not save location history: ${(err as Error).message}`);
      return 0;
    }
  }

  private settingsView(m: Pick<GroupMember, 'locationHistoryEnabled' | 'locationHistoryEnabledAt'>) {
    return {
      available: this.optInOpen, // false: hide the switch ("coming soon"); nobody can turn it on
      enabled: m.locationHistoryEnabled,
      enabledAt: m.locationHistoryEnabledAt,
      retentionDays: this.retentionDays,
      notice: this.notice,
    };
  }
}

function parseCursor(cursor: string): { at: number; id: string } {
  const match = /^(\d{1,15})_(\d{1,19})$/.exec(cursor);
  if (!match) throw new BadRequestException('Invalid cursor');
  return { at: Number(match[1]), id: match[2] };
}
