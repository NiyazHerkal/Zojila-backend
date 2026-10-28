import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { EnrichmentService, RoadStatus, type RoadBetween } from '../enrichment/enrichment.service.js';
import type { RoutePoint } from '../enrichment/routing.provider.js';
import { LocationService } from '../location/location.service.js';
import { REDIS } from '../redis/redis.module.js';

/** A member's live position older than this isn't routed from or to (it may be far off by now). */
export const MEMBER_POSITION_MAX_AGE_MS = 15 * 60_000;
/** Pairs routed at the same time, to stay polite to the routing server. */
const ROUTE_CONCURRENCY = 3;
/** Phones re-ask after ~50 m moves; a road route between the same ~11 m spots barely changes. */
const ROAD_CACHE_TTL_SECONDS = 5 * 60;

/** Why a pair has no route: one end has no usable live position (not sharing, none yet, or too old). */
export const LOCATION_UNAVAILABLE = 'LOCATION_UNAVAILABLE';

export type PairRoute =
  | RoadBetween
  | (Omit<RoadBetween, 'status'> & { status: typeof LOCATION_UNAVAILABLE });

export interface MemberRoutesView {
  members: { userId: string; locationAvailable: boolean; recordedAt: string | null }[];
  routes: (PairRoute & { fromUserId: string; toUserId: string })[];
}

/**
 * Road routes between trip members for the Journey map (backend handover 2026-10-22, P-05).
 * Member positions are always read from the live-location store, never taken from the request,
 * so a route can't reveal where someone is unless they're sharing with this group. Without a
 * real road route there is no line at all (no straight-line stand-in).
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly enrichment: EnrichmentService,
    private readonly location: LocationService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Every pair of the given members (2–6), each pair once. */
  async memberRoutes(groupId: string, userIds: string[]): Promise<MemberRoutesView> {
    if (new Set(userIds).size !== userIds.length) throw new BadRequestException('userIds must not repeat');
    this.location.assertLiveAvailable();
    const positions = await Promise.all(userIds.map((id) => this.memberPosition(groupId, id)));

    const pairs: [number, number][] = [];
    for (let i = 0; i < userIds.length; i++) for (let j = i + 1; j < userIds.length; j++) pairs.push([i, j]);
    const routes = await mapLimited(pairs, ROUTE_CONCURRENCY, async ([i, j]) => ({
      fromUserId: userIds[i],
      toUserId: userIds[j],
      ...(await this.between(positions[i], positions[j])),
    }));

    return {
      members: userIds.map((userId, i) => ({
        userId,
        locationAvailable: positions[i] !== null,
        recordedAt: positions[i]?.recordedAt ?? null,
      })),
      routes,
    };
  }

  /** From the caller's own position (sent by the app) to a sharing member or a fixed point. */
  async pointToPoint(groupId: string, from: RoutePoint, to: { userId: string } | RoutePoint): Promise<PairRoute> {
    if ('userId' in to) {
      this.location.assertLiveAvailable();
      return this.between(from, await this.memberPosition(groupId, to.userId));
    }
    return this.road(from, to);
  }

  private async between(a: RoutePoint | null, b: RoutePoint | null): Promise<PairRoute> {
    if (a && b) return this.road(a, b);
    return {
      status: LOCATION_UNAVAILABLE,
      profile: this.enrichment.routingProfile,
      geometry: null,
      distanceMeters: null,
      durationSeconds: null,
      attribution: this.enrichment.routingAttribution,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Road route between two points, cached in Redis by coordinates rounded to 4 decimals (~11 m),
   * shared by every group and API instance. Only real answers (OK, NO_ROUTE) are cached; a
   * provider failure is retried on the next request. Without Redis, every call goes to the router.
   */
  private async road(a: RoutePoint, b: RoutePoint): Promise<RoadBetween> {
    const coords = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(',');
    const key = `travelgo:road:${this.enrichment.routingProfile}:${coords}`;
    if (this.redis.status === 'ready') {
      const hit = await this.redis.get(key).catch(() => null);
      if (hit) return JSON.parse(hit) as RoadBetween;
    }
    const value = await this.enrichment.roadBetween(a, b);
    if ((value.status === RoadStatus.OK || value.status === RoadStatus.NO_ROUTE) && this.redis.status === 'ready') {
      await this.redis.set(key, JSON.stringify(value), 'EX', ROAD_CACHE_TTL_SECONDS).catch(() => undefined);
    }
    return value;
  }

  /** A member's live position in this group, or null if not sharing, none yet, or too old. */
  private async memberPosition(groupId: string, userId: string): Promise<(RoutePoint & { recordedAt: string }) | null> {
    const live = await this.location.livePosition(groupId, userId);
    if (!live) return null;
    const age = Date.now() - new Date(live.recordedAt).getTime();
    if (!(age <= MEMBER_POSITION_MAX_AGE_MS)) return null; // also rejects an unparseable time
    return { lat: live.lat, lng: live.lng, recordedAt: live.recordedAt };
  }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
