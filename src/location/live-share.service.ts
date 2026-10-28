import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import type { Namespace } from 'socket.io';
import { IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import {
  LiveShareDuration,
  LiveShareEndReason,
  LocationShareLink,
} from '../database/entities/index.js';
import { PushService } from '../notifications/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { REDIS } from '../redis/redis.module.js';
import type { LocationPointDto } from './dto/location.dto.js';
import type { LivePosition } from './location.service.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';

/** Socket events (change request v1.0 §15). Recipients get them on the `/live` namespace. */
export const LIVE_SHARE_EVENTS = {
  STARTED: 'location_share:started', // to the sharer's own devices
  UPDATE: 'location:update', // to recipients: the sharer moved
  STOPPED: 'location_share:stopped', // to recipients and the sharer's devices
} as const;

const DURATION_MS: Record<LiveShareDuration, number> = {
  [LiveShareDuration.FIFTEEN_MINUTES]: 15 * 60_000,
  [LiveShareDuration.ONE_HOUR]: 60 * 60_000,
  [LiveShareDuration.EIGHT_HOURS]: 8 * 60 * 60_000,
};
const DEFAULT_MAX_ACTIVE = 5;
const DEFAULT_LINK_BASE_URL = 'https://travelgo.app/live';
const FUTURE_SLACK_MS = 60_000;

const userPositionKey = (userId: string) => `travelgo:loc:user:${userId}`;
export const liveRoom = (linkId: string) => `live:${linkId}`;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Holds the `/live` socket namespace once its gateway has started (see LiveShareGateway). */
@Injectable()
export class LiveNamespaceRef {
  namespace: Namespace | null = null;
}

/**
 * Live location for people outside TravelGo (change request v1.0, change 10), like WhatsApp
 * live location. The sharer creates a link per recipient (15 min / 1 h / 8 h, at most 5 at a
 * time) and sends it however they like. Whoever has the link sees the sharer's latest position
 * until it expires or the sharer stops it, by polling `GET /public/live/:token` or over the
 * `/live` socket namespace. The recipient needs no account.
 *
 * Positions come from the sharer's normal feed (`POST /location`). Only the latest one is kept,
 * in Redis, while at least one link is active: no history. The token is 256-bit random; only its
 * hash is stored, and the link is shown to the sharer once.
 */
@Injectable()
export class LiveShareService {
  private readonly logger = new Logger(LiveShareService.name);
  private readonly maxActive: number;
  private readonly linkBaseUrl: string;

  constructor(
    @InjectRepository(LocationShareLink) private readonly links: Repository<LocationShareLink>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly ns: LiveNamespaceRef,
    config: ConfigService,
  ) {
    this.maxActive = Number(config.get<string>('LIVE_SHARE_MAX_ACTIVE')) || DEFAULT_MAX_ACTIVE;
    this.linkBaseUrl = (config.get<string>('LIVE_SHARE_LINK_BASE_URL')?.trim() || DEFAULT_LINK_BASE_URL).replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------- the sharer

  async start(userId: string, duration: LiveShareDuration, recipientLabel?: string) {
    const active = await this.activeLinks(userId);
    if (active.length >= this.maxActive) {
      throw new ConflictException(`You can share your live location with at most ${this.maxActive} people at a time. Stop one first.`);
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + DURATION_MS[duration]);
    const link = await this.links.save(
      this.links.create({ userId, recipientLabel: recipientLabel?.trim() || null, tokenHash: hashToken(token), duration, expiresAt }),
    );
    const view = this.ownerView(link);
    await this.realtime.emitToUser(userId, LIVE_SHARE_EVENTS.STARTED, view);
    // The raw token is returned this once; only its hash is stored.
    return { ...view, token, link: `${this.linkBaseUrl}/${token}` };
  }

  /** The sharer's active links, newest first. */
  async list(userId: string) {
    return (await this.activeLinks(userId)).map((l) => this.ownerView(l));
  }

  async stop(userId: string, linkId: string) {
    const link = await this.links.findOne({ where: { id: linkId, userId } });
    if (!link) throw new NotFoundException('Live location link not found');
    if (isActive(link)) await this.end(link, LiveShareEndReason.STOPPED);
  }

  /** Ends every active link of the user (account deletion). */
  async stopAll(userId: string) {
    for (const link of await this.activeLinks(userId)) await this.end(link, LiveShareEndReason.STOPPED);
  }

  activeLinks(userId: string): Promise<LocationShareLink[]> {
    return this.links.find({
      where: { userId, endedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { startedAt: 'DESC' },
    });
  }

  /**
   * Called by `POST /location` when the sharer has active links: keeps the newest point as their
   * live position and sends it to everyone watching. Points from before the oldest active link
   * started are never shown.
   */
  async publish(userId: string, links: LocationShareLink[], points: LocationPointDto[]): Promise<LivePosition | null> {
    const now = Date.now();
    const earliestStart = Math.min(...links.map((l) => l.startedAt.getTime()));
    const valid = points
      .filter((p) => !p.recordedAt || new Date(p.recordedAt).getTime() <= now + FUTURE_SLACK_MS)
      .map((p) => ({ ...p, at: Math.min(p.recordedAt ? new Date(p.recordedAt).getTime() : now, now) }))
      .filter((p) => p.at >= earliestStart - 5_000);
    if (!valid.length) return null;

    const newest = valid.reduce((a, b) => (b.at > a.at ? b : a));
    const position: LivePosition = {
      lat: newest.lat,
      lng: newest.lng,
      accuracy: newest.accuracy ?? null,
      heading: newest.heading ?? null,
      speed: newest.speed ?? null,
      recordedAt: new Date(newest.at).toISOString(),
    };
    const previous = await this.position(userId);
    if (previous && previous.recordedAt >= position.recordedAt) return previous; // late batch

    const lastExpiry = Math.max(...links.map((l) => l.expiresAt.getTime()));
    await this.redisCall(() => this.redis.set(userPositionKey(userId), JSON.stringify(position), 'PXAT', lastExpiry));
    for (const link of links) this.toRecipients(link.id, LIVE_SHARE_EVENTS.UPDATE, { sessionId: link.id, ...position });
    return position;
  }

  // ---------------------------------------------------------------- the recipient

  /**
   * What the recipient's page shows. 404 for an unknown token, 410 once the share has ended.
   * The first look notifies the sharer (once).
   */
  async view(token: string) {
    const link = await this.activeByToken(token);
    const position = await this.position(link.userId).catch(() => null);
    return {
      sessionId: link.id,
      sharer: { name: link.user.name, avatarUrl: link.user.avatarUrl },
      recipientLabel: link.recipientLabel,
      startedAt: link.startedAt,
      expiresAt: link.expiresAt,
      remainingSeconds: remainingSeconds(link),
      updateIntervalSeconds: 10,
      // Only positions recorded while this link was on.
      location: position && new Date(position.recordedAt) >= new Date(link.startedAt.getTime() - 5_000) ? position : null,
    };
  }

  /** Resolves a token to its active link (for the socket handshake too). Records the view. */
  async activeByToken(token: string): Promise<LocationShareLink> {
    const link = await this.links.findOne({ where: { tokenHash: hashToken(token) }, relations: { user: true } });
    if (!link) throw new NotFoundException('This live location link is not valid');
    if (!isActive(link)) {
      if (!link.endedAt) await this.end(link, LiveShareEndReason.EXPIRED); // overdue: tell everyone now
      throw new GoneException('This live location has ended');
    }
    await this.recordView(link);
    return link;
  }

  // ---------------------------------------------------------------- expiry

  /** Run by the minutely sweep: ends overdue links, telling recipients and the sharer. */
  async expireDue(): Promise<number> {
    const due = await this.links.find({ where: { endedAt: IsNull(), expiresAt: LessThanOrEqual(new Date()) } });
    for (const link of due) await this.end(link, LiveShareEndReason.EXPIRED);
    return due.length;
  }

  // ---------------------------------------------------------------- internals

  private async end(link: LocationShareLink, reason: LiveShareEndReason) {
    const endedAt = reason === LiveShareEndReason.EXPIRED ? link.expiresAt : new Date();
    // Conditional, so a stop and the sweep racing each other end it (and notify) only once.
    const result = await this.links.update({ id: link.id, endedAt: IsNull() }, { endedAt, endReason: reason });
    if (!result.affected) return;

    const payload = { sessionId: link.id, reason, endedAt };
    this.toRecipients(link.id, LIVE_SHARE_EVENTS.STOPPED, payload);
    // Leave the namespace only (no `true`): closing the whole connection would also drop any
    // other namespace the same client is multiplexing on it.
    this.ns.namespace?.in(liveRoom(link.id)).disconnectSockets();
    await this.realtime.emitToUser(link.userId, LIVE_SHARE_EVENTS.STOPPED, payload);
    if (!(await this.activeLinks(link.userId)).length) {
      await this.redis.del(userPositionKey(link.userId)).catch(() => undefined); // nobody may see it any more
    }
    if (reason === LiveShareEndReason.EXPIRED) {
      await this.push.sendToUser(link.userId, {
        title: 'Live location sharing ended',
        body: `Your live location link${link.recipientLabel ? ` for ${link.recipientLabel}` : ''} has expired.`,
        data: { type: 'LIVE_SHARE_EXPIRED', sessionId: link.id },
      });
    }
  }

  private async recordView(link: LocationShareLink) {
    const now = new Date();
    const first = await this.links.update({ id: link.id, firstViewedAt: IsNull() }, { firstViewedAt: now, lastViewedAt: now });
    if (first.affected) {
      link.firstViewedAt = now;
      await this.push.sendToUser(link.userId, {
        title: 'Your live location was opened',
        body: `${link.recipientLabel ?? 'Someone'} opened your live location link.`,
        data: { type: 'LIVE_SHARE_VIEWED', sessionId: link.id },
      });
    } else {
      await this.links.update({ id: link.id }, { lastViewedAt: now });
    }
    link.lastViewedAt = now;
  }

  private toRecipients(linkId: string, event: string, payload: unknown) {
    this.ns.namespace?.to(liveRoom(linkId)).emit(event, payload);
  }

  private async position(userId: string): Promise<LivePosition | null> {
    const raw = await this.redisCall(() => this.redis.get(userPositionKey(userId)));
    return raw ? (JSON.parse(raw) as LivePosition) : null;
  }

  private ownerView(link: LocationShareLink) {
    return {
      id: link.id,
      recipientLabel: link.recipientLabel,
      duration: link.duration,
      startedAt: link.startedAt,
      expiresAt: link.expiresAt,
      remainingSeconds: remainingSeconds(link),
      firstViewedAt: link.firstViewedAt,
      lastViewedAt: link.lastViewedAt,
    };
  }

  private async redisCall<T>(fn: () => Promise<T>): Promise<T> {
    if (this.redis.status !== 'ready') {
      throw withCode(new ServiceUnavailableException('Live location is temporarily unavailable (Redis is down)'), ErrorCode.LIVE_LOCATION_UNAVAILABLE);
    }
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Redis command failed: ${(err as Error).message}`);
      throw withCode(new ServiceUnavailableException('Live location is temporarily unavailable (Redis is down)'), ErrorCode.LIVE_LOCATION_UNAVAILABLE);
    }
  }
}

function isActive(link: LocationShareLink): boolean {
  return !link.endedAt && link.expiresAt.getTime() > Date.now();
}

function remainingSeconds(link: LocationShareLink): number {
  return Math.max(0, Math.round((link.expiresAt.getTime() - Date.now()) / 1000));
}
