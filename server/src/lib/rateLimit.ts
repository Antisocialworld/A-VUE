import { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { getRedisClient } from './redis.js';

const WINDOW_SECONDS = 60; // 1-minute window per AGENTS.md

/**
 * Atomic Lua script to increment counter and guarantee expiration is always set.
 * Fixes Task 7: Atomic execution + sets expiry whenever key's TTL is -1,
 * so a process crash can never leave an unexpired permanent block.
 */
const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl == -1 or current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

export async function authRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ip = request.ip || '127.0.0.1';
  const key = `rate_limit:auth:${ip}`;

  try {
    const redis = getRedisClient();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => {});
    }

    const result = (await redis.eval(
      RATE_LIMIT_LUA,
      1,
      key,
      WINDOW_SECONDS,
    )) as [number, number];

    const count = Number(result[0]);
    let ttl = Number(result[1]);
    if (ttl <= 0) {
      ttl = WINDOW_SECONDS;
    }

    if (count > env.RATE_LIMIT_AUTH_IP) {
      reply.header('Retry-After', ttl);
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication requests. Please try again later.',
          requestId: request.id,
        },
      });
    }
  } catch (err: any) {
    // Fail closed with 503 per prompt requirement (Security decision reported in summary)
    process.stderr.write(`[RateLimit Warning] Redis rate limit offline: ${err.message}\n`);
    return reply.status(503).send({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service temporarily unavailable. Please try again later.',
        requestId: request.id,
      },
    });
  }
}
