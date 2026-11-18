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

export async function posterRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ip = request.ip || '127.0.0.1';
  const key = `rate_limit:poster:${ip}`;
  const POSTER_LIMIT = 120; // 120/min per IP strict poster rate limit

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

    if (count > POSTER_LIMIT) {
      reply.header('Retry-After', ttl);
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many poster requests. Please try again later.',
          requestId: request.id,
        },
      });
    }
  } catch (err: any) {
    process.stderr.write(`[RateLimit Warning] Redis poster rate limit offline: ${err.message}\n`);
  }
}

/**
 * Checks dual rate limits (per user AND per IP).
 * Fails closed with 503 if Redis is unavailable.
 */
async function checkDualRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  options: {
    category: string;
    userId?: string;
    userLimit: number;
    ipLimit: number;
    actionDescription: string;
  }
): Promise<boolean> {
  const ip = request.ip || '127.0.0.1';
  const redis = getRedisClient();

  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => {});
    }

    // 1. Check IP limit
    const ipKey = `rate_limit:${options.category}:ip:${ip}`;
    const ipRes = (await redis.eval(RATE_LIMIT_LUA, 1, ipKey, WINDOW_SECONDS)) as [number, number];
    const ipCount = Number(ipRes[0]);
    const ipTtl = Number(ipRes[1]) > 0 ? Number(ipRes[1]) : WINDOW_SECONDS;

    if (ipCount > options.ipLimit) {
      reply.header('Retry-After', ipTtl);
      reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many ${options.actionDescription} requests from this IP. Please try again later.`,
          requestId: request.id,
        },
      });
      return false;
    }

    // 2. Check User limit (if authenticated)
    if (options.userId) {
      const userKey = `rate_limit:${options.category}:user:${options.userId}`;
      const userRes = (await redis.eval(RATE_LIMIT_LUA, 1, userKey, WINDOW_SECONDS)) as [number, number];
      const userCount = Number(userRes[0]);
      const userTtl = Number(userRes[1]) > 0 ? Number(userRes[1]) : WINDOW_SECONDS;

      if (userCount > options.userLimit) {
        reply.header('Retry-After', userTtl);
        reply.status(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many ${options.actionDescription} requests for your account. Please try again later.`,
            requestId: request.id,
          },
        });
        return false;
      }
    }

    return true;
  } catch (err: any) {
    process.stderr.write(`[RateLimit Error] Redis rate limit offline for ${options.category}: ${err.message}\n`);
    reply.status(503).send({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `${options.actionDescription} service temporarily unavailable. Please retry.`,
        requestId: request.id,
      },
    });
    return false;
  }
}

export async function holdRateLimit(request: FastifyRequest, reply: FastifyReply, userId?: string): Promise<boolean> {
  return checkDualRateLimit(request, reply, {
    category: 'hold',
    userId,
    userLimit: env.RATE_LIMIT_HOLD_USER,
    ipLimit: env.RATE_LIMIT_HOLD_IP,
    actionDescription: 'seat hold',
  });
}

export async function checkoutRateLimit(request: FastifyRequest, reply: FastifyReply, userId?: string): Promise<boolean> {
  return checkDualRateLimit(request, reply, {
    category: 'checkout',
    userId,
    userLimit: env.RATE_LIMIT_CHECKOUT_USER,
    ipLimit: env.RATE_LIMIT_CHECKOUT_IP,
    actionDescription: 'checkout',
  });
}

export async function searchRateLimit(request: FastifyRequest, reply: FastifyReply, userId?: string): Promise<boolean> {
  return checkDualRateLimit(request, reply, {
    category: 'search',
    userId,
    userLimit: env.RATE_LIMIT_SEARCH_USER,
    ipLimit: env.RATE_LIMIT_SEARCH_IP,
    actionDescription: 'search',
  });
}

export async function onDemandRateLimit(request: FastifyRequest, reply: FastifyReply, userId?: string): Promise<boolean> {
  return checkDualRateLimit(request, reply, {
    category: 'ondemand',
    userId,
    userLimit: env.RATE_LIMIT_ONDEMAND_USER,
    ipLimit: env.RATE_LIMIT_ONDEMAND_IP,
    actionDescription: 'on-demand showtime scheduling',
  });
}

export async function assistantRateLimit(request: FastifyRequest, reply: FastifyReply, userId: string): Promise<boolean> {
  return checkDualRateLimit(request, reply, {
    category: 'assistant',
    userId,
    userLimit: env.ASSISTANT_RATE_USER_PER_MIN,
    ipLimit: env.ASSISTANT_RATE_IP_PER_MIN,
    actionDescription: 'assistant',
  });
}

