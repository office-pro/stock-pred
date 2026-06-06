import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getEnv } from '@stockpred/shared-utils';

/** Redis cache with graceful degradation: the feed survives a Redis outage. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private healthy = false;

  constructor() {
    this.client = new Redis(getEnv('REDIS_URL', 'redis://localhost:6379'), {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 1000, 15_000),
    });
    this.client.on('ready', () => {
      this.healthy = true;
    });
    this.client.on('error', () => {
      if (this.healthy) console.warn('[market-data] Redis unavailable; caching disabled');
      this.healthy = false;
    });
  }

  async setJson(key: string, value: unknown): Promise<void> {
    if (!this.healthy) return;
    try {
      await this.client.set(key, JSON.stringify(value));
    } catch {
      /* cache write is best-effort */
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
