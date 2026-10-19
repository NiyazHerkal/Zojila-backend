import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivitiesService } from '../activities/activities.service.js';
import { AlertsService } from '../chat/alerts.service.js';
import { ChatService } from '../chat/chat.service.js';
import { UsageService } from '../analytics/usage.service.js';
import { type GroupMember, GroupRole, UsageMetric } from '../database/entities/index.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { ItineraryService } from '../itinerary/itinerary.service.js';
import { StatusService } from '../status/status.service.js';

const RECENT_MESSAGES = 100;
const MAX_ACTIVE_ALERTS = 100;
const RECENT_ACTIVITY_UPDATES = 200;

/**
 * Everything the app needs to keep a trip usable without a connection (PDF §2.8, build plan
 * Phase 11), in one call: group + members, the finalized itinerary (+ the draft for admins),
 * statuses, expenses with the settle-up summary, recent chat and active alerts. Map tiles aren't
 * part of it: offline map downloads were dropped (2026-10-05), the app only caches what it views.
 *
 * The bundle comes with an ETag (a hash of its content), so the app can re-check cheaply with
 * If-None-Match and get 304 when nothing changed.
 */
@Injectable()
export class OfflineService {
  constructor(
    private readonly groups: GroupsService,
    private readonly itinerary: ItineraryService,
    private readonly activities: ActivitiesService,
    private readonly status: StatusService,
    private readonly expenses: ExpensesService,
    private readonly chat: ChatService,
    private readonly alerts: AlertsService,
    private readonly usage: UsageService,
  ) {}

  async bundle(groupId: string, me: GroupMember) {
    this.usage.record(UsageMetric.OFFLINE_BUNDLE_FETCHED, me.userId, groupId);
    const isAdmin = me.role === GroupRole.ADMIN;
    const [group, members, itinerary, draft, statuses, money, messages, unread, activeAlerts, activityUpdates] = await Promise.all([
      this.groups.findOne(groupId, me),
      this.groups.listMembers(groupId),
      orNull(this.itinerary.getLatest(groupId)),
      isAdmin ? orNull(this.itinerary.getDraft(groupId)) : Promise.resolve(null),
      this.status.current(groupId),
      this.expenses.reportData(groupId, me),
      this.chat.list(groupId, me.userId, { limit: RECENT_MESSAGES }),
      this.chat.unread(groupId, me),
      this.alerts.list(groupId, me.userId, { active: true, limit: MAX_ACTIVE_ALERTS }),
      this.activities.recentUpdates(groupId, me, RECENT_ACTIVITY_UPDATES),
    ]);

    const content = {
      group,
      members,
      itinerary,
      draft,
      activityUpdates, // newest first; each stop's status is on the itinerary's waypoints
      statuses,
      expenses: {
        items: money.expenses.reverse(), // newest first, like GET …/expenses
        summary: money.summary,
        settlements: [...money.settlements].reverse(),
      },
      chat: { messages: messages.items, olderMessages: messages.nextBefore !== null, unread },
      activeAlerts: activeAlerts.items,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(content)).digest('base64url').slice(0, 27)}"`;
    return { etag, body: { generatedAt: new Date(), ...content } };
  }
}

/** The itinerary endpoints throw 404 when there's nothing yet; in the bundle that's just null. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundException) return null;
    throw err;
  }
}
