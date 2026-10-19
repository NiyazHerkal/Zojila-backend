import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from './redis/redis.module.js';

export interface Health {
  status: 'ok' | 'degraded' | 'down';
  db: 'connected' | 'unreachable';
  redis: 'connected' | 'unreachable';
  version: string;
  uptimeSeconds: number;
}

const CHECK_TIMEOUT_MS = 1500;

/** APP_VERSION (set by the deploy), else package.json's version. */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

@Injectable()
export class AppService {
  private readonly version = appVersion();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * For uptime monitors. `down` (DB unreachable: nothing works) → the controller answers 503.
   * `degraded` (Redis unreachable: only live location is off) → 200, so it shows as a warning.
   */
  async getHealth(): Promise<Health> {
    const [db, redis] = await Promise.all([
      withTimeout(this.dataSource.query('SELECT 1')),
      withTimeout(this.redis.status === 'ready' ? this.redis.ping() : Promise.reject(new Error('not ready'))),
    ]);
    return {
      status: !db ? 'down' : !redis ? 'degraded' : 'ok',
      db: db ? 'connected' : 'unreachable',
      redis: redis ? 'connected' : 'unreachable',
      version: this.version,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}

/** true if the check succeeded within the timeout. */
async function withTimeout(check: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check,
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS))),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
