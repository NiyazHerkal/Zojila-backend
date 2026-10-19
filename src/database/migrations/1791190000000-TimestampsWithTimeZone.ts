import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The six early columns created as `timestamp without time zone` (tracker, Housekeeping). */
const COLUMNS: [table: string, column: string][] = [
  ['users', 'created_at'],
  ['groups', 'created_at'],
  ['group_members', 'joined_at'],
  ['invites', 'created_at'],
  ['itineraries', 'created_at'],
  ['location_pings', 'recorded_at'],
];

/**
 * Converts them to `timestamptz` in place. Their values were written as the database's local
 * time (`now()` in the server's TimeZone, Asia/Calcutta on the dev machine), so they're read in
 * that zone. ALTER … USING keeps every value; `synchronize` would have dropped the columns.
 */
export class TimestampsWithTimeZone1791190000000 implements MigrationInterface {
  name = 'TimestampsWithTimeZone1791190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      // Skip columns that are already timestamptz: converting again would shift their values.
      const [info] = await queryRunner.query(
        `SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [table, column],
      );
      if (info?.data_type !== 'timestamp without time zone') continue;
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE USING "${column}" AT TIME ZONE current_setting('TimeZone')`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP USING "${column}" AT TIME ZONE current_setting('TimeZone')`,
      );
    }
  }
}
