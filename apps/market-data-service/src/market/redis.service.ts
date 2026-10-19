import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getRedisUrl } from '@stockpred/shared-utils';
import { MDS_QUOTE_REDIS_TTL_SECONDS } from './quote-freshness';

/** Redis cache with graceful degradation: the feed survives a Redis outage. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private healthy = false;

  constructor() {
    this.client = new Redis(getRedisUrl(), {
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

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.healthy) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      /* Redis failure must not become a data failure — caller falls through. */
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number = MDS_QUOTE_REDIS_TTL_SECONDS,
  ): Promise<void> {
    if (!this.healthy) return;
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await this.client.set(key, payload, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, payload);
      }
    } catch {
      /* cache write is best-effort */
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
