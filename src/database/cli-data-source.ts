import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source.js';

/** Entry point for the TypeORM CLI (`npm run migration:*`), which doesn't go through Nest's ConfigModule. */
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

export default new DataSource(dataSourceOptions());
