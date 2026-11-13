/**
 * UNVERIFIED PLATFORM ITEM: Upstash Redis connection over TCP from Vercel Serverless.
 * Rule: Upstash in production over TCP, Docker locally over TCP.
 * Status: Unverified on Vercel until Phase 0 deployment proof.
 * This module is isolated so it can be swapped for @upstash/redis (REST API client)
 * if TCP connection limits or socket drops occur under serverless cold starts.
 */

import { Redis } from 'ioredis';
import { env } from '../env.js';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 2000);
      },
    });

    redisInstance.on('error', (err) => {
      // Safe error output without printing passwords or hosts (Rule 02)
      process.stderr.write(`[Redis Error] Socket error: ${err.message}\n`);
    });
  }

  return redisInstance;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (client.status !== 'ready') {
      await client.connect().catch(() => {});
    }
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

