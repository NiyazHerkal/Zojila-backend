import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  ActivityProgress,
  ActivityStatus,
  ActivityUpdate,
  Group,
  Itinerary,
  ItineraryStatus,
  Waypoint,
} from '../database/entities/index.js';
import { altitudeContext, type AltitudeContext } from '../enrichment/altitude.js';
import {
  EnrichmentService,
  RouteStatus,
  WeatherStatus,
  type RouteLeg,
  type TripRoute,
  type WeatherResult,
} from '../enrichment/enrichment.service.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';
import { NotificationFeedService, TRIP_FEED_TYPES } from '../notifications/notification-feed.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { CreateWaypointDto } from './dto/create-waypoint.dto.js';
import type { UpdateWaypointDto } from './dto/update-waypoint.dto.js';
import { ItineraryPdfService } from './itinerary-pdf.service.js';

const MIN_WAYPOINTS_TO_FINALIZE = 2; // a route needs a start and an end point

/** Socket event when an admin publishes a new itinerary version. */
export const ITINERARY_UPDATED_EVENT = 'itinerary:updated';

export enum WaypointRole {
  START = 'START',
  MID = 'MID',
  END = 'END',
}

export type ElevationView =
  | ({ status: 'OK' } & AltitudeContext)
  | { status: 'NOT_CONFIGURED' | 'UNAVAILABLE' };

/** Progress of a stop as an "activity" (change request v1.0, changes 3–4). */
export interface ActivityState {
  status: ActivityStatus;
  statusUpdatedAt: Date | null;
  statusUpdatedBy: { userId: string; name: string } | null;
  updateCount: number;
}

export interface WaypointView {
  id: string;
  /** Stays the same for this stop in every version; use it for activity status and updates. */
  activityId: string;
  position: number; // 1-based
  role: WaypointRole;
  name: string;
  lat: number;
  lng: number;
  date: string | null;
  /** The stop's date is before tripStart or after tripEnd (e.g. after the trip dates were edited). */
  outsideTripDates: boolean;
  /** HH:mm, wall-clock time at the stop; null when not set. */
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  elevation: ElevationView;
  weather: WeatherResult;
  activity: ActivityState;
}

export interface ItineraryView {
  id: string;
  groupId: string;
  status: ItineraryStatus;
  version: number | null;
  basedOnVersion: number | null;
  revision: number;
  createdById: string;
  createdAt: Date;
  lockedAt: Date | null;
  waypoints: WaypointView[];
}

/** The trip map line: the stops joined in order, along roads where possible. */
export interface ItineraryRouteView extends Omit<TripRoute, 'legs'> {
  itineraryId: string;
  itineraryStatus: ItineraryStatus;
  version: number | null;
  legs: (RouteLeg & { fromActivityId: string; toActivityId: string })[];
}

type RouteBody = Omit<ItineraryRouteView, 'itineraryId' | 'itineraryStatus' | 'version'>;

/** What `itineraries.route_json` holds: the route and a key of the pins it was built from. */
interface CachedRoute {
  key: string;
  route: RouteBody;
}

/**
 * Map-based itinerary (PDF §2.3.2–2.3.3). Admins edit a single DRAFT per group; finalizing
 * locks it as the next version, which is what viewers see. Start/end points are the first/last
 * pins in the order (reorder to change them). See Itinerary entity for the version model.
 */
@Injectable()
export class ItineraryService {
  constructor(
    @InjectRepository(Itinerary) private readonly itineraries: Repository<Itinerary>,
    @InjectRepository(Waypoint) private readonly waypoints: Repository<Waypoint>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(ActivityProgress) private readonly progress: Repository<ActivityProgress>,
    @InjectRepository(ActivityUpdate) private readonly activityUpdates: Repository<ActivityUpdate>,
    private readonly dataSource: DataSource,
    private readonly enrichment: EnrichmentService,
    private readonly pdf: ItineraryPdfService,
    private readonly realtime: RealtimeService,
    private readonly feed: NotificationFeedService,
  ) {}

  // --- finalized versions (all members) ---

  async getLatest(groupId: string): Promise<ItineraryView> {
    return this.view(await this.requireLocked(groupId));
  }

  async getVersion(groupId: string, version: number): Promise<ItineraryView> {
    return this.view(await this.requireLocked(groupId, version));
  }

  async listVersions(groupId: string) {
    const versions = await this.itineraries.find({
      where: { groupId, status: ItineraryStatus.LOCKED },
      order: { version: 'DESC' },
    });
    const counts = await this.waypointCounts(versions.map((v) => v.id));
    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      lockedAt: v.lockedAt,
      createdById: v.createdBy,
      waypointCount: counts.get(v.id) ?? 0,
    }));
  }

  /** Map line for the latest (or a given) finalized version (members). */
  async getRoute(groupId: string, version?: number): Promise<ItineraryRouteView> {
    return this.route(await this.requireLocked(groupId, version));
  }

  /** Map line for the draft, while the admin edits it. */
  async getDraftRoute(groupId: string): Promise<ItineraryRouteView> {
    return this.route(await this.requireDraft(groupId));
  }

  async exportPdf(groupId: string, version?: number): Promise<{ file: Buffer; filename: string }> {
    const itinerary = await this.requireLocked(groupId, version);
    const [group, view, route] = await Promise.all([
      this.groups.findOneByOrFail({ id: groupId }),
      this.view(itinerary),
      this.route(itinerary),
    ]);
    // The PDF draws the road line when there is one; otherwise its usual straight lines.
    const roads = route.status === RouteStatus.OK || route.status === RouteStatus.PARTIAL;
    const file = await this.pdf.render(group, view, roads ? route.geometry.coordinates : null);
    const slug = group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
    return { file, filename: `${slug}-itinerary-v${itinerary.version}.pdf` };
  }

  // --- draft (admins) ---

  async getDraft(groupId: string): Promise<ItineraryView> {
    return this.view(await this.requireDraft(groupId));
  }

  /** Starts a draft: a copy of the latest finalized version, or empty if there is none yet. */
  async createDraft(groupId: string, userId: string): Promise<ItineraryView> {
    const latest = await this.findLocked(groupId);
    let draft: Itinerary;
    try {
      draft = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(Itinerary, {
            groupId,
            status: ItineraryStatus.DRAFT,
            createdBy: userId,
            basedOnVersion: latest?.version ?? null,
          }),
        );
        if (latest) {
          const source = await manager.find(Waypoint, { where: { itineraryId: latest.id } });
          await manager.save(
            source.map((w) =>
              manager.create(Waypoint, {
                itineraryId: created.id,
                stopKey: w.stopKey, // same stop, so its activity status and updates carry over
                order: w.order,
                name: w.name,
                lat: w.lat,
                lng: w.lng,
                date: w.date,
                startTime: w.startTime,
                endTime: w.endTime,
                notes: w.notes,
                elevation: w.elevation,
                weatherJson: w.weatherJson,
              }),
            ),
          );
        }
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This group already has a draft itinerary');
      throw err;
    }
    return this.view(draft);
  }

  async discardDraft(groupId: string): Promise<void> {
    const result = await this.itineraries.delete({ groupId, status: ItineraryStatus.DRAFT });
    if (!result.affected) throw new NotFoundException('No draft itinerary');
  }

  async addWaypoint(groupId: string, dto: CreateWaypointDto, expectedRevision?: number): Promise<ItineraryView> {
    await this.requireDraft(groupId); // fail fast before calling third-party APIs
    const date = dto.date ?? null;
    const startTime = dto.startTime ?? null;
    const endTime = dto.endTime ?? null;
    assertTimes(startTime, endTime);
    const [elevation, weather] = await Promise.all([
      this.enrichment.elevationFor(dto.lat, dto.lng),
      this.enrichment.weatherFor(dto.lat, dto.lng, date),
    ]);

    return this.mutateDraft(groupId, async (manager, draft, pins) => {
      const index = Math.min(Math.max((dto.position ?? pins.length + 1) - 1, 0), pins.length);
      pins.splice(
        index,
        0,
        manager.create(Waypoint, {
          itineraryId: draft.id,
          name: dto.name,
          lat: dto.lat,
          lng: dto.lng,
          date,
          startTime,
          endTime,
          notes: dto.notes ?? null,
          elevation,
          weatherJson: weather as unknown as Record<string, unknown>,
        }),
      );
      await this.saveInOrder(manager, pins);
    }, expectedRevision);
  }

  async updateWaypoint(
    groupId: string,
    waypointId: string,
    dto: UpdateWaypointDto,
    expectedRevision?: number,
  ): Promise<ItineraryView> {
    // A pin moves as a whole: half a coordinate pair would silently mix the old and new place.
    if ((dto.lat == null) !== (dto.lng == null)) {
      throw new BadRequestException('Send lat and lng together to move a pin');
    }
    const draft = await this.requireDraft(groupId);
    const current = await this.waypoints.findOne({ where: { id: waypointId, itineraryId: draft.id } });
    if (!current) throw new NotFoundException('Waypoint not found in the draft');

    const lat = dto.lat ?? current.lat;
    const lng = dto.lng ?? current.lng;
    const date = dto.date === undefined ? current.date : dto.date;
    const startTime = dto.startTime === undefined ? current.startTime : dto.startTime;
    const endTime = dto.endTime === undefined ? current.endTime : dto.endTime;
    assertTimes(startTime, endTime);
    const moved = lat !== current.lat || lng !== current.lng;
    const [elevation, weather] = await Promise.all([
      moved ? this.enrichment.elevationFor(lat, lng) : current.elevation,
      moved || date !== current.date ? this.enrichment.weatherFor(lat, lng, date) : current.weatherJson,
    ]);

    return this.mutateDraft(groupId, async (manager, _draft, pins) => {
      const pin = pins.find((p) => p.id === waypointId);
      if (!pin) throw new NotFoundException('Waypoint not found in the draft');
      if (dto.name != null) pin.name = dto.name;
      if (dto.notes !== undefined) pin.notes = dto.notes;
      Object.assign(pin, { lat, lng, date, startTime, endTime, elevation, weatherJson: weather });
      await manager.save(pin);
    }, expectedRevision);
  }

  async removeWaypoint(groupId: string, waypointId: string, expectedRevision?: number): Promise<ItineraryView> {
    return this.mutateDraft(groupId, async (manager, _draft, pins) => {
      const index = pins.findIndex((p) => p.id === waypointId);
      if (index === -1) throw new NotFoundException('Waypoint not found in the draft');
      await manager.remove(pins[index]);
      pins.splice(index, 1);
      await this.saveInOrder(manager, pins);
    }, expectedRevision);
  }

  /** Drag-and-drop reorder: the full list of pin ids in their new order. */
  async reorder(groupId: string, waypointIds: string[], expectedRevision?: number): Promise<ItineraryView> {
    return this.mutateDraft(groupId, async (manager, _draft, pins) => {
      const byId = new Map(pins.map((p) => [p.id, p]));
      if (waypointIds.length !== pins.length || waypointIds.some((id) => !byId.has(id))) {
        throw new BadRequestException('waypointIds must list every waypoint in the draft exactly once');
      }
      await this.saveInOrder(manager, waypointIds.map((id) => byId.get(id)!));
    }, expectedRevision);
  }

  /** Admin confirms the draft: it becomes the next locked version, visible to the whole group. */
  async finalize(groupId: string, expectedRevision?: number, actorId?: string): Promise<ItineraryView> {
    const locked = await this.dataSource.transaction(async (manager) => {
      const draft = await this.lockDraft(manager, groupId);
      assertRevision(draft, expectedRevision);
      const pinCount = await manager.count(Waypoint, { where: { itineraryId: draft.id } });
      if (pinCount < MIN_WAYPOINTS_TO_FINALIZE) {
        throw new BadRequestException(
          `An itinerary needs at least ${MIN_WAYPOINTS_TO_FINALIZE} waypoints (a start and an end point) to be finalized`,
        );
      }
      const latest = await manager
        .createQueryBuilder(Itinerary, 'i')
        .select('MAX(i.version)', 'max')
        .where('i.group_id = :groupId', { groupId })
        .getRawOne<{ max: number | null }>();

      draft.status = ItineraryStatus.LOCKED;
      draft.version = (latest?.max ?? 0) + 1;
      draft.lockedAt = new Date();
      return manager.save(draft);
    });
    await this.realtime.emitToGroup(groupId, ITINERARY_UPDATED_EVENT, {
      groupId,
      version: locked.version,
      lockedAt: locked.lockedAt,
    });
    await this.feed.recordForGroup(
      groupId,
      actorId ?? null,
      TRIP_FEED_TYPES.ITINERARY_UPDATED,
      (trip) => ({
        title: trip,
        body: locked.version === 1 ? 'The itinerary is ready' : `The itinerary was updated (version ${locked.version})`,
      }),
      { version: String(locked.version) },
    );
    return this.view(locked);
  }

  /**
   * Re-fetches elevation + weather for every pin, e.g. once API keys are configured or as the
   * trip gets close enough to forecast. Allowed on the latest finalized version too: it only
   * touches external data, never the plan itself.
   */
  async refreshEnrichment(groupId: string, target: 'draft' | 'latest'): Promise<ItineraryView> {
    const itinerary = target === 'draft' ? await this.requireDraft(groupId) : await this.requireLocked(groupId);
    const pins = await this.waypoints.find({ where: { itineraryId: itinerary.id } });
    await Promise.all(
      pins.map(async (pin) => {
        const [elevation, weather] = await Promise.all([
          this.enrichment.elevationFor(pin.lat, pin.lng),
          this.enrichment.weatherFor(pin.lat, pin.lng, pin.date),
        ]);
        const previous = pin.weatherJson as WeatherResult | null;
        // Keep a good forecast rather than replacing it with a transient provider failure.
        const keepOld = weather.status === WeatherStatus.UNAVAILABLE && previous?.status === WeatherStatus.OK;
        pin.elevation = elevation ?? pin.elevation;
        pin.weatherJson = (keepOld ? previous : weather) as unknown as Record<string, unknown>;
        await this.waypoints.save(pin);
      }),
    );
    return this.view(itinerary);
  }

  // --- internals ---

  private findLocked(groupId: string, version?: number): Promise<Itinerary | null> {
    return this.itineraries.findOne({
      where: { groupId, status: ItineraryStatus.LOCKED, ...(version !== undefined && { version }) },
      order: { version: 'DESC' },
    });
  }

  private async requireLocked(groupId: string, version?: number): Promise<Itinerary> {
    const itinerary = await this.findLocked(groupId, version);
    if (!itinerary) {
      throw new NotFoundException(
        version === undefined ? 'No finalized itinerary yet' : `Itinerary version ${version} not found`,
      );
    }
    return itinerary;
  }

  private async requireDraft(groupId: string): Promise<Itinerary> {
    const draft = await this.itineraries.findOne({ where: { groupId, status: ItineraryStatus.DRAFT } });
    if (!draft) throw new NotFoundException('No draft itinerary. Start one with POST /groups/:groupId/itinerary/draft');
    return draft;
  }

  private async lockDraft(manager: EntityManager, groupId: string): Promise<Itinerary> {
    const draft = await manager.findOne(Itinerary, {
      where: { groupId, status: ItineraryStatus.DRAFT },
      lock: { mode: 'pessimistic_write' },
    });
    if (!draft) throw new NotFoundException('No draft itinerary. Start one with POST /groups/:groupId/itinerary/draft');
    return draft;
  }

  // Draft edits run in a transaction with the draft row locked, so concurrent edits by two
  // admins can't interleave and corrupt the pin order. Each edit bumps the revision; with
  // `expectedRevision` (the If-Match header) an edit based on an outdated copy is refused.
  private async mutateDraft(
    groupId: string,
    change: (manager: EntityManager, draft: Itinerary, pins: Waypoint[]) => Promise<void>,
    expectedRevision?: number,
  ): Promise<ItineraryView> {
    const draft = await this.dataSource.transaction(async (manager) => {
      const locked = await this.lockDraft(manager, groupId);
      assertRevision(locked, expectedRevision);
      const pins = await manager.find(Waypoint, { where: { itineraryId: locked.id }, order: { order: 'ASC' } });
      await change(manager, locked, pins);
      locked.revision += 1;
      await manager.update(Itinerary, { id: locked.id }, { revision: locked.revision });
      return locked;
    });
    return this.view(draft);
  }

  private async saveInOrder(manager: EntityManager, pins: Waypoint[]): Promise<void> {
    pins.forEach((pin, i) => (pin.order = i));
    await manager.save(pins);
  }

  private async waypointCounts(itineraryIds: string[]): Promise<Map<string, number>> {
    if (!itineraryIds.length) return new Map();
    const rows = await this.waypoints
      .createQueryBuilder('w')
      .select('w.itinerary_id', 'itineraryId')
      .addSelect('COUNT(*)::int', 'count')
      .where('w.itinerary_id IN (:...itineraryIds)', { itineraryIds })
      .groupBy('w.itinerary_id')
      .getRawMany<{ itineraryId: string; count: number }>();
    return new Map(rows.map((r) => [r.itineraryId, r.count]));
  }

  /**
   * Built on first request and cached on the itinerary under a key of the pins it was built from
   * (and the routing profile), so it's rebuilt only when a pin is added, moved or reordered. A
   * straight-line fallback after a provider failure isn't cached, so the next request retries.
   */
  private async route(itinerary: Itinerary): Promise<ItineraryRouteView> {
    const pins = await this.waypoints.find({ where: { itineraryId: itinerary.id }, order: { order: 'ASC' } });
    const key = createHash('sha256')
      .update(JSON.stringify([this.enrichment.routingProfile, pins.map((p) => [p.stopKey, p.lat, p.lng])]))
      .digest('hex');
    const header = { itineraryId: itinerary.id, itineraryStatus: itinerary.status, version: itinerary.version };

    const cached = itinerary.routeJson as unknown as CachedRoute | null;
    if (cached?.key === key) return { ...header, ...cached.route };

    const trip = await this.enrichment.routeThrough(pins.map((p) => ({ lat: p.lat, lng: p.lng })));
    const route: RouteBody = {
      ...trip,
      legs: trip.legs.map((leg, i) => ({ ...leg, fromActivityId: pins[i].stopKey, toActivityId: pins[i + 1].stopKey })),
    };
    if (trip.status !== RouteStatus.UNAVAILABLE) {
      const routeJson: CachedRoute = { key, route };
      await this.itineraries.update({ id: itinerary.id }, { routeJson });
    }
    return { ...header, ...route };
  }

  private async view(itinerary: Itinerary): Promise<ItineraryView> {
    const pins = await this.waypoints.find({ where: { itineraryId: itinerary.id }, order: { order: 'ASC' } });
    const [activities, group] = await Promise.all([
      this.activityStates(itinerary.groupId),
      this.groups.findOne({ where: { id: itinerary.groupId }, select: { id: true, tripStart: true, tripEnd: true } }),
    ]);
    // Trip dates are midnight UTC of the chosen day (see the API docs), so the UTC date part is the day.
    const tripDays = group ? { start: utcDay(group.tripStart), end: utcDay(group.tripEnd) } : null;
    return {
      id: itinerary.id,
      groupId: itinerary.groupId,
      status: itinerary.status,
      version: itinerary.version,
      basedOnVersion: itinerary.basedOnVersion,
      revision: itinerary.revision,
      createdById: itinerary.createdBy,
      createdAt: itinerary.createdAt,
      lockedAt: itinerary.lockedAt,
      waypoints: pins.map((pin, i) => this.waypointView(pin, i, pins.length, tripDays, activities.get(pin.stopKey))),
    };
  }

  /** Status + number of updates per stop key, for the whole group. */
  private async activityStates(groupId: string): Promise<Map<string, ActivityState>> {
    const [rows, counts] = await Promise.all([
      this.progress.find({ where: { groupId }, relations: { updatedBy: true } }),
      this.activityUpdates
        .createQueryBuilder('u')
        .select('u.stop_key', 'stopKey')
        .addSelect('COUNT(*)::int', 'count')
        .where('u.group_id = :groupId AND u.deleted_at IS NULL', { groupId })
        .groupBy('u.stop_key')
        .getRawMany<{ stopKey: string; count: number }>(),
    ]);
    const states = new Map<string, ActivityState>();
    for (const r of rows) {
      states.set(r.stopKey, {
        status: r.status,
        statusUpdatedAt: r.updatedAt,
        statusUpdatedBy: { userId: r.updatedById, name: r.updatedBy.name },
        updateCount: 0,
      });
    }
    for (const c of counts) {
      const state = states.get(c.stopKey) ?? { ...UPCOMING };
      states.set(c.stopKey, { ...state, updateCount: c.count });
    }
    return states;
  }

  private waypointView(
    pin: Waypoint,
    index: number,
    total: number,
    tripDays: { start: string; end: string } | null,
    activity?: ActivityState,
  ): WaypointView {
    const role = index === 0 ? WaypointRole.START : index === total - 1 ? WaypointRole.END : WaypointRole.MID;
    const elevation: ElevationView =
      pin.elevation !== null
        ? { status: 'OK', ...altitudeContext(pin.elevation) }
        : { status: this.enrichment.elevationConfigured ? 'UNAVAILABLE' : 'NOT_CONFIGURED' };
    return {
      id: pin.id,
      activityId: pin.stopKey,
      position: index + 1,
      role,
      name: pin.name,
      lat: pin.lat,
      lng: pin.lng,
      date: pin.date,
      outsideTripDates: !!(pin.date && tripDays && (pin.date < tripDays.start || pin.date > tripDays.end)),
      startTime: pin.startTime,
      endTime: pin.endTime,
      notes: pin.notes,
      elevation,
      weather: (pin.weatherJson as WeatherResult | null) ?? {
        status: WeatherStatus.UNAVAILABLE,
        fetchedAt: new Date(0).toISOString(),
      },
      activity: activity ?? { ...UPCOMING },
    };
  }
}

const UPCOMING: ActivityState = {
  status: ActivityStatus.UPCOMING,
  statusUpdatedAt: null,
  statusUpdatedBy: null,
  updateCount: 0,
};

function utcDay(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** An end time needs a start time and must come after it (same day; HH:mm compares as text). */
function assertTimes(startTime: string | null, endTime: string | null): void {
  if (endTime && !startTime) throw new BadRequestException('endTime needs a startTime');
  if (startTime && endTime && endTime <= startTime) {
    throw new BadRequestException('endTime must be after startTime');
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505';
}

/** 412 when an admin edits the draft from an outdated copy (If-Match ≠ current revision). */
function assertRevision(draft: Itinerary, expected?: number): void {
  if (expected !== undefined && expected !== draft.revision) {
    throw withCode(
      new PreconditionFailedException(
        `The draft has changed since you loaded it (now revision ${draft.revision}). Reload it, then try again.`,
      ),
      ErrorCode.DRAFT_CHANGED,
    );
  }
}
