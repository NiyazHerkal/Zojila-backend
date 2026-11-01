import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Feedback, Group, Invite, LocationHistoryPoint, LocationShareLink, Notification, UsageDaily, User } from '../database/entities/index.js';
import { GroupsService } from '../groups/groups.service.js';
import { locationHistoryRetentionDays } from '../location/location-history.service.js';
import { NOTIFICATION_RETENTION_DAYS } from '../notifications/notification-feed.service.js';
import { reportError } from '../security/sentry.js';
import { StorageService } from '../storage/storage.service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FIRST_RUN_DELAY_MS = 60 * 1000;
const LIVE_LINK_RETENTION_DAYS = 30;

export interface RetentionResult {
  closedGroupsDeleted: number;
  unverifiedAccountsDeleted: number;
  oldInvitesDeleted: number;
  oldUsageRowsDeleted: number;
  oldFeedbackDeleted: number;
  oldLiveLinksDeleted: number;
  oldNotificationsDeleted: number;
  oldLocationHistoryDeleted: number;
}

/**
 * Data retention (PDF §4 "configurable user data retention policy", "group data deletion on group
 * closure"). Runs hourly; every step is idempotent, so running it on several servers is harmless.
 *   - Closed trips past their `delete_after` date are deleted with all their data and receipts.
 *   - Accounts never verified after UNVERIFIED_ACCOUNT_RETENTION_DAYS (default 7) are deleted.
 *   - Invites that expired more than INVITE_RETENTION_DAYS ago (default 30) are deleted.
 *   - Usage counters older than USAGE_RETENTION_DAYS (180) and feedback older than
 *     FEEDBACK_RETENTION_DAYS (365) are deleted.
 *   - Live location links (people outside the app) are deleted 30 days after they ended.
 *   - Notifications feed entries are deleted after NOTIFICATION_RETENTION_DAYS (90).
 *   - Saved location history (opt-in trails) older than LOCATION_HISTORY_RETENTION_DAYS (30).
 *     Reads never return older points either, so nothing past the period is shown even between runs.
 * Set RETENTION_JOB_DISABLED=true to turn the timer off (tests).
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private readonly unverifiedDays: number;
  private readonly inviteDays: number;
  private readonly usageDays: number;
  private readonly feedbackDays: number;
  private readonly locationHistoryDays: number;
  private readonly enabled: boolean;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    config: ConfigService,
    @InjectRepository(Group) private readonly groupRepo: Repository<Group>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Invite) private readonly invites: Repository<Invite>,
    @InjectRepository(UsageDaily) private readonly usage: Repository<UsageDaily>,
    @InjectRepository(Feedback) private readonly feedback: Repository<Feedback>,
    @InjectRepository(LocationShareLink) private readonly liveLinks: Repository<LocationShareLink>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(LocationHistoryPoint) private readonly locationHistory: Repository<LocationHistoryPoint>,
    private readonly groups: GroupsService,
    private readonly storage: StorageService,
  ) {
    this.unverifiedDays = positive(config.get<string>('UNVERIFIED_ACCOUNT_RETENTION_DAYS'), 7);
    this.inviteDays = positive(config.get<string>('INVITE_RETENTION_DAYS'), 30);
    this.usageDays = positive(config.get<string>('USAGE_RETENTION_DAYS'), 180);
    this.feedbackDays = positive(config.get<string>('FEEDBACK_RETENTION_DAYS'), 365);
    this.locationHistoryDays = locationHistoryRetentionDays(config);
    this.enabled = config.get<string>('RETENTION_JOB_DISABLED') !== 'true';
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    const run = () => this.runOnce().catch((err: Error) => {
      this.logger.error(`Retention run failed: ${err.message}`, err.stack);
      reportError(err, 'retention');
    });
    this.timers = [setTimeout(run, FIRST_RUN_DELAY_MS), setInterval(run, HOUR_MS)];
    this.timers.forEach((t) => t.unref());
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async runOnce(now = new Date()): Promise<RetentionResult> {
    const result = {
      closedGroupsDeleted: await this.purgeClosedGroups(now),
      unverifiedAccountsDeleted: await this.purgeUnverifiedAccounts(now),
      oldInvitesDeleted: await this.purgeOldInvites(now),
      oldUsageRowsDeleted: await this.purgeOldUsage(now),
      oldFeedbackDeleted: await this.purgeOldFeedback(now),
      oldLiveLinksDeleted: await this.purgeOldLiveLinks(now),
      oldNotificationsDeleted: await this.purgeOldNotifications(now),
      oldLocationHistoryDeleted: await this.purgeOldLocationHistory(now),
    };
    if (Object.values(result).some(Boolean)) {
      this.logger.log(`Retention: ${JSON.stringify(result)}`);
    }
    return result;
  }

  /** Saved location history points recorded more than LOCATION_HISTORY_RETENTION_DAYS ago. */
  async purgeOldLocationHistory(now: Date, onlyUserIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - this.locationHistoryDays * DAY_MS);
    const res = await this.locationHistory.delete({ recordedAt: LessThan(cutoff), ...(onlyUserIds && { userId: In(onlyUserIds) }) });
    return res.affected ?? 0;
  }

  /** Notifications feed entries older than NOTIFICATION_RETENTION_DAYS. */
  async purgeOldNotifications(now: Date, onlyUserIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    const res = await this.notifications.delete({ createdAt: LessThan(cutoff), ...(onlyUserIds && { userId: In(onlyUserIds) }) });
    return res.affected ?? 0;
  }

  // Each step takes an optional `onlyIds` so tests can run it against their own rows without
  // touching anything else in a shared database.

  /** Closed trips past their delete_after date: deleted with all their data and receipt files. */
  async purgeClosedGroups(now: Date, onlyIds?: string[]): Promise<number> {
    const overdue = await this.groupRepo.find({
      where: { deleteAfter: LessThan(now), ...(onlyIds && { id: In(onlyIds) }) },
      select: { id: true },
    });
    for (const group of overdue) await this.groups.remove(group.id);
    return overdue.length;
  }

  /** Accounts never verified within the retention period. */
  async purgeUnverifiedAccounts(now: Date, onlyIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - this.unverifiedDays * DAY_MS);
    const unverified = await this.users.find({
      where: {
        emailVerified: false,
        phoneVerified: false,
        deletedAt: IsNull(),
        createdAt: LessThan(cutoff),
        ...(onlyIds && { id: In(onlyIds) }),
      },
      select: { id: true },
    });
    let deleted = 0;
    for (const user of unverified) {
      try {
        await this.users.delete({ id: user.id });
        deleted++;
      } catch (err) {
        // Something references the account (shouldn't happen for an account that never logged in).
        this.logger.warn(`Kept unverified account ${user.id}: ${(err as Error).message}`);
      }
    }
    return deleted;
  }

  /** Live location links that ended (or expired) more than 30 days ago. */
  async purgeOldLiveLinks(now: Date, onlyUserIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - LIVE_LINK_RETENTION_DAYS * DAY_MS);
    const res = await this.liveLinks.delete({ expiresAt: LessThan(cutoff), ...(onlyUserIds && { userId: In(onlyUserIds) }) });
    return res.affected ?? 0;
  }

  /** Usage counters older than USAGE_RETENTION_DAYS (default 180). */
  async purgeOldUsage(now: Date, onlyUserIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - this.usageDays * DAY_MS).toLocaleDateString('en-CA');
    const res = await this.usage.delete({ day: LessThan(cutoff), ...(onlyUserIds && { userId: In(onlyUserIds) }) });
    return res.affected ?? 0;
  }

  /** Feedback older than FEEDBACK_RETENTION_DAYS (default 365), with its screenshots. */
  async purgeOldFeedback(now: Date, onlyIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - this.feedbackDays * DAY_MS);
    const old = await this.feedback.find({
      where: { createdAt: LessThan(cutoff), ...(onlyIds && { id: In(onlyIds) }) },
      select: { id: true },
    });
    for (const row of old) {
      await this.feedback.delete({ id: row.id });
      await this.storage.deletePrefix(`feedback/${row.id}`);
    }
    return old.length;
  }

  /** Invites that expired more than the retention period ago. */
  async purgeOldInvites(now: Date, onlyGroupIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - this.inviteDays * DAY_MS);
    const res = await this.invites.delete({ expiresAt: LessThan(cutoff), ...(onlyGroupIds && { groupId: In(onlyGroupIds) }) });
    return res.affected ?? 0;
  }
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return n > 0 ? n : fallback;
}
