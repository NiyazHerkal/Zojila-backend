import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UsageMetric } from '../database/entities/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, string | number | null>;

/**
 * Beta metrics for the team (PDF §9 success metrics, Phase 13 DoD). Everything is computed live
 * from the database; trip-sized data makes that cheap. "Users" excludes deleted accounts.
 */
@Injectable()
export class OpsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** KPIs for the period since `since` (default: the last 30 days). */
  async stats(since?: string) {
    const from = since ? new Date(`${since}T00:00:00`) : new Date(Date.now() - 30 * DAY_MS);
    const one = async (sql: string, params: unknown[] = []): Promise<Row> => (await this.db.query<Row[]>(sql, params))[0] ?? {};
    const num = (v: unknown) => Number(v ?? 0);
    const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

    const [users, active, retention, groups, invites, chat, location, expenses, itinerary, safety, offline, feedback] = await Promise.all([
      one(
        `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND (email_verified OR phone_verified)) AS verified,
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= $1) AS new_in_period,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
           FROM users`,
        [from],
      ),
      one(
        `SELECT COUNT(DISTINCT user_id) FILTER (WHERE day >= CURRENT_DATE) AS d1,
                COUNT(DISTINCT user_id) FILTER (WHERE day > CURRENT_DATE - 7) AS d7,
                COUNT(DISTINCT user_id) FILTER (WHERE day > CURRENT_DATE - 30) AS d30,
                COUNT(DISTINCT user_id) FILTER (WHERE day >= $1::date) AS in_period
           FROM usage_daily WHERE metric = $2`,
        [from, UsageMetric.APP_CONNECTED],
      ),
      // Week-1 retention: of verified users who signed up 7+ days ago (in the period), how many
      // opened the app again 7 or more days after signing up.
      one(
        `SELECT COUNT(*) AS cohort,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM usage_daily d WHERE d.user_id = u.id AND d.metric = $2 AND d.day >= (u.created_at::date + 7))) AS retained
           FROM users u
          WHERE u.deleted_at IS NULL AND (u.email_verified OR u.phone_verified)
            AND u.created_at >= $1 AND u.created_at < now() - interval '7 days'`,
        [from, UsageMetric.APP_CONNECTED],
      ),
      one(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE g.created_at >= $1) AS created_in_period,
                COUNT(*) FILTER (WHERE m.members >= 2) AS with_2_plus_members,
                ROUND(AVG(m.members)::numeric, 1) AS avg_members,
                COUNT(*) FILTER (WHERE g.closed_at IS NOT NULL) AS closed,
                ROUND(AVG(EXTRACT(EPOCH FROM (g.trip_end - g.trip_start)) / 86400)::numeric, 1) AS avg_trip_days
           FROM groups g
           JOIN (SELECT group_id, COUNT(*) AS members FROM group_members GROUP BY group_id) m ON m.group_id = g.id`,
        [from],
      ),
      one(
        `SELECT COUNT(*) FILTER (WHERE channel <> 'LINK') AS sent,
                COUNT(*) FILTER (WHERE channel <> 'LINK' AND status = 'ACCEPTED') AS accepted,
                COUNT(*) FILTER (WHERE channel <> 'LINK' AND status = 'REJECTED') AS rejected,
                COUNT(*) FILTER (WHERE channel = 'LINK') AS links_created
           FROM invites WHERE created_at >= $1`,
        [from],
      ),
      one(
        `SELECT COUNT(*) AS messages, COUNT(DISTINCT group_id) AS groups, COUNT(DISTINCT sender_id) AS senders
           FROM messages WHERE type = 'NORMAL' AND created_at >= $1`,
        [from],
      ),
      one(
        `SELECT COUNT(DISTINCT user_id) AS sharers, COALESCE(SUM(count), 0) AS shares_started, COUNT(DISTINCT group_id) AS groups
           FROM usage_daily WHERE metric = $2 AND day >= $1::date`,
        [from, UsageMetric.LOCATION_SHARE_STARTED],
      ),
      one(
        `SELECT (SELECT COUNT(*) FROM expenses WHERE created_at >= $1) AS expenses,
                (SELECT COUNT(DISTINCT group_id) FROM expenses WHERE created_at >= $1) AS groups,
                (SELECT COUNT(*) FROM expense_settlements WHERE created_at >= $1) AS repayments,
                (SELECT COUNT(*) FROM expenses WHERE created_at >= $1 AND receipt_key IS NOT NULL) AS with_receipt`,
        [from],
      ),
      one(
        `SELECT (SELECT COUNT(DISTINCT group_id) FROM itineraries WHERE status = 'LOCKED') AS groups_with_finalized,
                (SELECT COALESCE(SUM(count), 0) FROM usage_daily WHERE metric = $2 AND day >= $1::date) AS pdf_exports,
                (SELECT COALESCE(SUM(count), 0) FROM usage_daily WHERE metric = $3 AND day >= $1::date) AS expense_reports`,
        [from, UsageMetric.ITINERARY_PDF_EXPORTED, UsageMetric.EXPENSE_REPORT_EXPORTED],
      ),
      one(
        `SELECT (SELECT COUNT(*) FROM messages WHERE type = 'SOS' AND created_at >= $1) AS sos,
                (SELECT COUNT(*) FROM messages WHERE type = 'CRITICAL' AND created_at >= $1) AS critical_alerts,
                (SELECT COUNT(*) FROM status_updates WHERE status = 'NEED_HELP' AND created_at >= $1) AS need_help,
                (SELECT COUNT(*) FROM status_updates WHERE created_at >= $1) AS status_updates`,
        [from],
      ),
      one(
        `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(count), 0) AS fetches
           FROM usage_daily WHERE metric = $2 AND day >= $1::date`,
        [from, UsageMetric.OFFLINE_BUNDLE_FETCHED],
      ),
      this.db.query<Row[]>(`SELECT category, status, COUNT(*) AS n FROM feedback GROUP BY category, status`),
    ]);

    const activeInPeriod = num(active.in_period);
    const groupCount = num(groups.total);
    return {
      period: { from, to: new Date() },
      users: {
        total: num(users.total),
        verified: num(users.verified),
        newInPeriod: num(users.new_in_period),
        deletedAccounts: num(users.deleted),
        active: { today: num(active.d1), last7Days: num(active.d7), last30Days: num(active.d30), inPeriod: activeInPeriod },
        week1Retention: { cohort: num(retention.cohort), retained: num(retention.retained), percent: rate(num(retention.retained), num(retention.cohort)) },
      },
      groups: {
        total: groupCount,
        createdInPeriod: num(groups.created_in_period),
        withTwoOrMoreMembers: num(groups.with_2_plus_members),
        averageMembers: num(groups.avg_members),
        closed: num(groups.closed),
        averageTripDays: num(groups.avg_trip_days),
      },
      invites: {
        emailAndSmsSent: num(invites.sent),
        accepted: num(invites.accepted),
        rejected: num(invites.rejected),
        acceptancePercent: rate(num(invites.accepted), num(invites.sent)),
        shareLinksCreated: num(invites.links_created),
      },
      chat: { messages: num(chat.messages), groupsChatting: num(chat.groups), peopleChatting: num(chat.senders) },
      location: {
        peopleWhoShared: num(location.sharers),
        sharesStarted: num(location.shares_started),
        groupsWithSharing: num(location.groups),
        adoptionPercent: rate(num(location.sharers), activeInPeriod),
      },
      expenses: {
        expenses: num(expenses.expenses),
        groupsUsingExpenses: num(expenses.groups),
        groupsUsingPercent: rate(num(expenses.groups), groupCount),
        withReceipt: num(expenses.with_receipt),
        repayments: num(expenses.repayments),
      },
      itinerary: {
        groupsWithFinalizedItinerary: num(itinerary.groups_with_finalized),
        pdfExports: num(itinerary.pdf_exports),
        expenseReportExports: num(itinerary.expense_reports),
      },
      safety: {
        sosRaised: num(safety.sos),
        criticalAlerts: num(safety.critical_alerts),
        needHelpStatuses: num(safety.need_help),
        statusUpdates: num(safety.status_updates),
      },
      offline: { peopleUsingOffline: num(offline.users), bundleFetches: num(offline.fetches) },
      feedback: (feedback as Row[]).map((r) => ({ category: r.category, status: r.status, count: num(r.n) })),
      stability: {
        crashFreeSessionsPercent: null,
        note: 'Crash-free sessions come from the app’s crash reporting (Sentry/Crashlytics in the app), not the backend.',
      },
    };
  }

  /**
   * One row per trip with the features it actually used: the beta DoD is "a cohort completes at
   * least one real trip end-to-end". Newest trip first.
   */
  async trips(limit = 50) {
    const rows = await this.db.query<Row[]>(
      `SELECT g.id, g.name, g.trip_start, g.trip_end, g.closed_at, g.created_at,
              (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
              (SELECT MAX(version) FROM itineraries i WHERE i.group_id = g.id AND i.status = 'LOCKED') AS itinerary_version,
              (SELECT COUNT(*) FROM messages x WHERE x.group_id = g.id AND x.type = 'NORMAL') AS chat_messages,
              (SELECT COUNT(*) FROM messages x WHERE x.group_id = g.id AND x.type IN ('GENERAL', 'CRITICAL', 'SOS')) AS alerts,
              (SELECT COUNT(*) FROM status_updates s WHERE s.group_id = g.id) AS status_updates,
              (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id) AS expenses,
              (SELECT COUNT(DISTINCT user_id) FROM usage_daily d WHERE d.group_id = g.id AND d.metric = $1) AS location_sharers,
              (SELECT COALESCE(SUM(count), 0) FROM usage_daily d WHERE d.group_id = g.id AND d.metric = $2) AS pdf_exports,
              (SELECT COALESCE(SUM(count), 0) FROM usage_daily d WHERE d.group_id = g.id AND d.metric = $3) AS offline_fetches
         FROM groups g
        ORDER BY g.trip_start DESC
        LIMIT $4`,
      [UsageMetric.LOCATION_SHARE_STARTED, UsageMetric.ITINERARY_PDF_EXPORTED, UsageMetric.OFFLINE_BUNDLE_FETCHED, limit],
    );
    return rows.map((r) => {
      const n = (k: string) => Number(r[k] ?? 0);
      const checklist = {
        groupOfTwoOrMore: n('members') >= 2,
        finalizedItinerary: r.itinerary_version !== null,
        chatUsed: n('chat_messages') > 0,
        locationShared: n('location_sharers') > 0,
        statusUsed: n('status_updates') > 0,
        expensesLogged: n('expenses') > 0,
        tripEnded: new Date(String(r.trip_end)) < new Date(),
      };
      return {
        groupId: r.id,
        name: r.name,
        tripStart: r.trip_start,
        tripEnd: r.trip_end,
        closedAt: r.closed_at,
        members: n('members'),
        itineraryVersion: r.itinerary_version === null ? null : Number(r.itinerary_version),
        chatMessages: n('chat_messages'),
        alerts: n('alerts'),
        statusUpdates: n('status_updates'),
        expenses: n('expenses'),
        locationSharers: n('location_sharers'),
        pdfExports: n('pdf_exports'),
        offlineFetches: n('offline_fetches'),
        checklist,
        endToEnd: Object.values(checklist).every(Boolean),
      };
    });
  }
}
