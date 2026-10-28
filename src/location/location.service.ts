import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { LessThanOrEqual, Repository } from 'typeorm';
import { UsageService } from '../analytics/usage.service.js';
import { LocationShare, ShareDuration, UsageMetric } from '../database/entities/index.js';
import { PushService } from '../notifications/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { REDIS, redisOptions } from '../redis/redis.module.js';
import { StatusService } from '../status/status.service.js';
import type { LocationPointDto } from './dto/location.dto.js';
import { LiveShareService } from './live-share.service.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';

export const LOCATION_QUEUE = 'location-sharing';
export const LocationEvents = {
  UPDATED: 'location:updated', // to group: a member's new position
  SHARING_STARTED: 'location:sharing-started', // to group
  SHARING_STOPPED: 'location:sharing-stopped', // to group: reason STOPPED | EXPIRED | REMOVED
  SHARE_EXPIRED: 'location:share-expired', // to the sharer only: "your sharing ended"
} as const;

const DURATION_MS: Record<ShareDuration, number | null> = {
  [ShareDuration.ONE_HOUR]: 60 * 60_000,
  [ShareDuration.FOUR_HOURS]: 4 * 60 * 60_000,
  [ShareDuration.EIGHT_HOURS]: 8 * 60 * 60_000,
  [ShareDuration.ALWAYS]: null,
};
const DURATION_LABEL: Record<ShareDuration, string> = {
  [ShareDuration.ONE_HOUR]: '1-hour',
  [ShareDuration.FOUR_HOURS]: '4-hour',
  [ShareDuration.EIGHT_HOURS]: '8-hour',
  [ShareDuration.ALWAYS]: '',
};
const DEFAULT_UPDATE_INTERVAL_SECONDS = 10;
const FUTURE_SLACK_MS = 60_000; // device clocks drift; later timestamps are clamped to now
const SWEEP_EVERY_MS = 60_000;

const positionsKey = (groupId: string) => `travelgo:loc:${groupId}`;

export interface LivePosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
}

/**
 * Live location (PDF §2.4). A member turns sharing on per group for 1h / 4h / 8h / Always.
 * While on, the app sends positions (every ~10 s); each new one is stored as their latest
 * position in Redis (live only, no history) and pushed to the group as `location:updated`.
 *
 * Expiry: a delayed BullMQ job fires at `expiresAt`, deletes the session, tells the group and
 * notifies the sharer (socket + push). A sweep every minute catches anything a job missed.
 *
 * The BullMQ queue + worker are managed here directly (not via @nestjs/bullmq) so shutdown can
 * force-disconnect when Redis is down. Otherwise closing waits for Redis forever and hangs
 * dev-server restarts and tests.
 */
@Injectable()
export class LocationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(LocationService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    @InjectRepository(LocationShare) private readonly shares: Repository<LocationShare>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly status: StatusService,
    private readonly config: ConfigService,
    private readonly usage: UsageService,
    private readonly liveShare: LiveShareService,
  ) {}

  onModuleInit(): void {
    const { host, port, username, password, db } = redisOptions(this.config);
    // Plain fields (BullMQ bundles its own ioredis typings); workers require maxRetriesPerRequest: null.
    const connection = { host, port, username, password, db, maxRetriesPerRequest: null };
    const prefix = 'travelgo';

    this.queue = new Queue(LOCATION_QUEUE, { connection, prefix });
    this.worker = new Worker(LOCATION_QUEUE, (job) => this.runJob(job), { connection, prefix });
    this.queue.on('error', (err) => this.logger.debug(`Queue error: ${err.message}`));
    this.worker.on('error', (err) => this.logger.debug(`Worker error: ${err.message}`));

    // Not awaited: if Redis is down this completes once it reconnects, without blocking startup.
    this.queue
      .upsertJobScheduler('expiry-sweep', { every: SWEEP_EVERY_MS }, { name: 'sweep' })
      .catch((err: Error) => this.logger.warn(`Could not schedule the expiry sweep: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    const graceful = this.redis.status === 'ready';
    const closed = Promise.all([this.worker.close(!graceful), this.queue.close()]).then(() => true);
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), graceful ? 5000 : 500));
    if (!(await Promise.race([closed, timeout]))) {
      await Promise.allSettled([this.worker.disconnect(), this.queue.disconnect()]);
    }
  }

  private async runJob(job: Job): Promise<unknown> {
    if (job.name === 'expire') {
      const { shareId, expiresAt } = job.data as { shareId: string; expiresAt: string };
      return this.expireShare(shareId, new Date(expiresAt).getTime());
    }
    if (job.name === 'sweep') return (await this.expireDueShares()) + (await this.liveShare.expireDue());
    this.logger.warn(`Unknown job ${job.name}`);
    return null;
  }

  get updateIntervalSeconds(): number {
    return Number(this.config.get('LOCATION_UPDATE_INTERVAL_SECONDS')) || DEFAULT_UPDATE_INTERVAL_SECONDS;
  }

  async mySession(groupId: string, userId: string) {
    return this.sessionView(await this.activeShare(groupId, userId));
  }

  /** Turn sharing on, or change the duration (the timer restarts from now). */
  async startSharing(groupId: string, userId: string, duration: ShareDuration) {
    this.assertRedis();
    const now = new Date();
    const ms = DURATION_MS[duration];
    const expiresAt = ms ? new Date(now.getTime() + ms) : null;

    await this.shares.upsert({ groupId, userId, duration, startedAt: now, expiresAt }, ['groupId', 'userId']);
    this.usage.record(UsageMetric.LOCATION_SHARE_STARTED, userId, groupId);
    const share = await this.shares.findOneOrFail({
      where: { groupId, userId },
      relations: { member: { user: true } },
    });

    // A previous timer for this share has a different job id (it includes expiresAt), so it
    // becomes a no-op; there's no need to cancel it.
    if (expiresAt) {
      await this.queue.add(
        'expire',
        { shareId: share.id, expiresAt: expiresAt.toISOString() },
        {
          jobId: `expire:${share.id}:${expiresAt.getTime()}`,
          delay: expiresAt.getTime() - Date.now(),
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }

    const user = share.member.user;
    await this.realtime.emitToGroup(groupId, LocationEvents.SHARING_STARTED, {
      groupId,
      userId,
      username: user.username,
      name: user.name,
      duration,
      startedAt: share.startedAt,
      expiresAt,
    });
    return this.sessionView(share);
  }

  async stopSharing(groupId: string, userId: string) {
    const result = await this.shares.delete({ groupId, userId });
    if (result.affected) await this.afterShareEnded(groupId, userId, 'STOPPED');
    return this.sessionView(null);
  }

  /** Positions from the app (1 point in the foreground, or a background batch). Only the newest is kept and broadcast. */
  async recordPositions(groupId: string, userId: string, points: LocationPointDto[]) {
    const share = await this.activeShare(groupId, userId);
    if (!share) throw new ConflictException('Location sharing is off. Start sharing first.');
    this.assertRedis();

    const now = Date.now();
    const valid = points
      .map((p) => ({ ...p, at: Math.min(p.recordedAt ? new Date(p.recordedAt).getTime() : now, now) }))
      .filter((p) => p.at >= share.startedAt.getTime() - 5_000) // never publish fixes from before sharing began
      .filter((p) => !p.recordedAt || new Date(p.recordedAt).getTime() <= now + FUTURE_SLACK_MS);
    if (!valid.length) return { accepted: 0, latest: null };

    const newest = valid.reduce((a, b) => (b.at > a.at ? b : a));
    const position: LivePosition = {
      lat: newest.lat,
      lng: newest.lng,
      accuracy: newest.accuracy ?? null,
      heading: newest.heading ?? null,
      speed: newest.speed ?? null,
      recordedAt: new Date(newest.at).toISOString(),
    };

    const stored = await this.redisCall(() => this.redis.hget(positionsKey(groupId), userId));
    const previous = stored ? (JSON.parse(stored) as LivePosition) : null;
    if (previous && previous.recordedAt >= position.recordedAt) {
      return { accepted: valid.length, latest: previous }; // late batch: nothing newer
    }
    await this.redisCall(() => this.redis.hset(positionsKey(groupId), userId, JSON.stringify(position)));
    await this.realtime.emitToGroup(groupId, LocationEvents.UPDATED, { groupId, userId, ...position });
    return { accepted: valid.length, latest: position };
  }

  /**
   * One position feed for the whole app (change request v1.0, changes 2 and 10): the points go to
   * every group the user is sharing with right now, and to their live links for people outside
   * the app. 409 when they aren't sharing anywhere, so a background plugin knows it can stop.
   */
  async recordEverywhere(userId: string, points: LocationPointDto[]) {
    const [sharing, links] = await Promise.all([this.activeShares(userId), this.liveShare.activeLinks(userId)]);
    if (!sharing.length && !links.length) throw new ConflictException('Location sharing is off. Start sharing first.');
    this.assertRedis();
    const groups = [];
    for (const share of sharing) {
      const result = await this.recordPositions(share.groupId, userId, points);
      groups.push({ groupId: share.groupId, ...result });
    }
    const liveLinks = links.length ? { active: links.length, latest: await this.liveShare.publish(userId, links, points) } : null;
    return { groups, liveLinks };
  }

  /** Every group the user is sharing their location with right now. */
  async mySharing(userId: string) {
    const sharing = await this.activeShares(userId);
    return {
      updateIntervalSeconds: this.updateIntervalSeconds,
      groups: sharing.map((s) => ({ groupId: s.groupId, groupName: s.member.group.name, ...this.sharingInfo(s) })),
    };
  }

  /** The group map: every member, their trip status, whether they're sharing, and their live position. */
  async feed(groupId: string) {
    this.assertRedis();
    const [members, shares, positions] = await Promise.all([
      this.status.current(groupId),
      this.shares.find({ where: { groupId } }),
      this.redisCall(() => this.redis.hgetall(positionsKey(groupId))),
    ]);

    const now = Date.now();
    const active = new Map(shares.filter((s) => !s.expiresAt || s.expiresAt.getTime() > now).map((s) => [s.userId, s]));
    const stale = Object.keys(positions).filter((uid) => !active.has(uid));
    if (stale.length) await this.redisCall(() => this.redis.hdel(positionsKey(groupId), ...stale));

    return {
      updateIntervalSeconds: this.updateIntervalSeconds,
      members: members.map((m) => {
        const share = active.get(m.userId);
        return {
          userId: m.userId,
          username: m.username,
          name: m.name,
          avatarUrl: m.avatarUrl,
          role: m.role,
          tripStatus: m.status,
          sharing: share ? this.sharingInfo(share) : null,
          location: share && positions[m.userId] ? (JSON.parse(positions[m.userId]) as LivePosition) : null,
        };
      }),
    };
  }

  /**
   * The member's live position if they're sharing with this group right now, else null.
   * Never throws (used by SOS, which must work even when Redis is down).
   */
  async livePosition(groupId: string, userId: string): Promise<LivePosition | null> {
    if (this.redis.status !== 'ready') return null;
    try {
      const share = await this.activeShare(groupId, userId);
      if (!share) return null;
      const raw = await this.redis.hget(positionsKey(groupId), userId);
      return raw ? (JSON.parse(raw) as LivePosition) : null;
    } catch (err) {
      this.logger.warn(`Could not read the live position: ${(err as Error).message}`);
      return null;
    }
  }

  /** Called by the expiry job (and the sweep). `expectedExpiresAt` guards against a share that was restarted. */
  async expireShare(shareId: string, expectedExpiresAt?: number): Promise<boolean> {
    const share = await this.shares.findOne({
      where: { id: shareId },
      relations: { member: { user: true, group: true } },
    });
    if (!share?.expiresAt) return false;
    if (expectedExpiresAt !== undefined && share.expiresAt.getTime() !== expectedExpiresAt) return false;
    if (share.expiresAt.getTime() > Date.now() + 1000) return false;

    // Conditional delete: if the member restarted sharing meanwhile, expiresAt changed and nothing happens.
    const result = await this.shares.delete({ id: share.id, expiresAt: share.expiresAt });
    if (!result.affected) return false;

    await this.afterShareEnded(share.groupId, share.userId, 'EXPIRED');
    const group = share.member.group;
    await this.realtime.emitToUser(share.userId, LocationEvents.SHARE_EXPIRED, {
      groupId: share.groupId,
      groupName: group.name,
      duration: share.duration,
    });
    await this.push.sendToUser(share.userId, {
      title: 'Live location sharing ended',
      body: `Your ${DURATION_LABEL[share.duration]} live location sharing with "${group.name}" has ended.`,
      data: { type: 'LOCATION_SHARE_EXPIRED', groupId: share.groupId },
    });
    return true;
  }

  /** Safety net for missed jobs (e.g. Redis was flushed): expires every overdue session. */
  async expireDueShares(): Promise<number> {
    const due = await this.shares.find({ where: { expiresAt: LessThanOrEqual(new Date()) }, select: { id: true } });
    let expired = 0;
    for (const { id } of due) if (await this.expireShare(id)) expired++;
    return expired;
  }

  // --- internals ---

  private async activeShares(userId: string): Promise<LocationShare[]> {
    const shares = await this.shares.find({ where: { userId }, relations: { member: { group: true } } });
    const now = Date.now();
    const active: LocationShare[] = [];
    for (const share of shares) {
      if (share.expiresAt && share.expiresAt.getTime() <= now) await this.expireShare(share.id);
      else active.push(share);
    }
    return active;
  }

  private async activeShare(groupId: string, userId: string): Promise<LocationShare | null> {
    const share = await this.shares.findOne({ where: { groupId, userId } });
    if (share?.expiresAt && share.expiresAt.getTime() <= Date.now()) {
      await this.expireShare(share.id); // overdue: expire now instead of waiting for the sweep
      return null;
    }
    return share;
  }

  private async afterShareEnded(groupId: string, userId: string, reason: 'STOPPED' | 'EXPIRED'): Promise<void> {
    await this.redis.hdel(positionsKey(groupId), userId).catch(() => undefined); // the feed also cleans up stale entries
    await this.realtime.emitToGroup(groupId, LocationEvents.SHARING_STOPPED, { groupId, userId, reason });
  }

  private sessionView(share: LocationShare | null) {
    const base = { updateIntervalSeconds: this.updateIntervalSeconds };
    return share ? { sharing: true, ...this.sharingInfo(share), ...base } : { sharing: false, ...base };
  }

  private sharingInfo(share: LocationShare) {
    return {
      duration: share.duration,
      startedAt: share.startedAt,
      expiresAt: share.expiresAt,
      remainingSeconds: share.expiresAt ? Math.max(0, Math.round((share.expiresAt.getTime() - Date.now()) / 1000)) : null,
    };
  }

  /** 503 when live positions can't be read (Redis down). For callers outside this service. */
  assertLiveAvailable(): void {
    this.assertRedis();
  }

  private assertRedis(): void {
    if (this.redis.status !== 'ready') {
      throw withCode(new ServiceUnavailableException('Live location is temporarily unavailable (Redis is down)'), ErrorCode.LIVE_LOCATION_UNAVAILABLE);
    }
  }

  private async redisCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Redis command failed: ${(err as Error).message}`);
      throw withCode(new ServiceUnavailableException('Live location is temporarily unavailable (Redis is down)'), ErrorCode.LIVE_LOCATION_UNAVAILABLE);
    }
  }
}
