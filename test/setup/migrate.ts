import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../src/database/data-source.js';

/**
 * Vitest global setup: applies pending migrations once, before any suite starts. The suites
 * run in parallel and each boots the app with DB_MIGRATIONS_RUN=false, so they don't race
 * to migrate the same database.
 */
export default async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
  const dataSource = new DataSource({ ...dataSourceOptions(process.env), logging: false });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
