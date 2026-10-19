import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { UsageMetric } from '../database/entities/index.js';

/**
 * Counts actions per user per day for the beta KPIs (see UsageDaily). Fire-and-forget: a failed
 * count is logged and never affects the request that triggered it.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  record(metric: UsageMetric, userId: string, groupId?: string | null): void {
    this.increment(metric, userId, groupId ?? null).catch((err: Error) =>
      this.logger.warn(`Usage count ${metric} failed: ${err.message}`),
    );
  }

  /** Awaitable version (tests). The day is the server's local date. */
  async increment(metric: UsageMetric, userId: string, groupId: string | null): Promise<void> {
    // Two partial unique indexes (with / without a trip) let the upsert treat "no trip" as a value.
    const conflict = groupId
      ? '("day", "metric", "user_id", "group_id") WHERE "group_id" IS NOT NULL'
      : '("day", "metric", "user_id") WHERE "group_id" IS NULL';
    await this.dataSource.query(
      `INSERT INTO "usage_daily" ("day", "metric", "user_id", "group_id", "count")
       VALUES (CURRENT_DATE, $1, $2, $3, 1)
       ON CONFLICT ${conflict} DO UPDATE SET "count" = "usage_daily"."count" + 1`,
      [metric, userId, groupId],
    );
  }
}
