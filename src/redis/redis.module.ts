import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * Connection options from REDIS_URL (default redis://localhost:6379; WSL's Redis is reachable
 * there from Windows). Shared by the app's own client and BullMQ.
 */
export function redisOptions(config: ConfigService): RedisOptions & { host: string; port: number } {
  const url = new URL(config.get<string>('REDIS_URL') || 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    // Reconnect forever with backoff: the API keeps serving everything else while Redis is down.
    retryStrategy: (times) => Math.min(times * 500, 5000),
  };
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}

/**
 * App-wide Redis client (live positions for Phase 7). Fail-soft: if Redis is unreachable,
 * commands fail fast (callers turn that into 503) instead of queueing, and the outage is
 * logged once rather than on every retry.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('Redis');
        const options = redisOptions(config);
        const client = new Redis({ ...options, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
        let down = false;
        client.on('error', (err: Error & { code?: string }) => {
          const reason = err.message || err.code || err.name; // connection-refused errors have an empty message
          if (!down) logger.warn(`Redis unavailable at ${options.host}:${options.port} (${reason}). Live location is off until it's back.`);
          down = true;
        });
        client.on('ready', () => {
          if (down) logger.log('Redis connection restored');
          down = false;
        });
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
