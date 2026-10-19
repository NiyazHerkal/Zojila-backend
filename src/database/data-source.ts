import type { DataSourceOptions } from 'typeorm';
import { entities } from './entities/index.js';
import { migrations } from './migrations/index.js';

/**
 * Database settings shared by the app (DatabaseModule) and the TypeORM CLI (`npm run migration:*`).
 *
 * The schema is managed by migrations (`src/database/migrations/`), never by `synchronize`:
 * that could drop columns and data. Migrations run when the app starts (DB_MIGRATIONS_RUN,
 * default true). Change an entity → `npm run migration:generate --name=WhatChanged` → review the
 * generated SQL → commit it.
 */
export function dataSourceOptions(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return {
    type: 'postgres',
    url,
    entities,
    migrations,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    // Only for generating/checking migrations in a scratch schema; normally the default "public".
    ...(env.DB_SCHEMA && { schema: env.DB_SCHEMA, extra: { options: `-c search_path=${env.DB_SCHEMA},public` } }),
    logging: env.NODE_ENV === 'development' && env.DB_LOGGING !== 'false',
  };
}
