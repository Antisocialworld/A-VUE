/**
 * Shared Email Send Cap and Cooldown Tracker
 * Rule 02 / Task 1 & 2:
 * Atomic Redis Lua script enforcing per-email daily cap and cooldown.
 * Parallel requests never exceed DAILY_CODE_SEND_CAP or beat the cooldown.
 * No in-memory Map fallback: if Redis is unreachable, sends no mail,
 * returns normal success response to caller, and logs one line (error class only).
 */

import { env } from '../env.js';
import { getRedisClient } from './redis.js';

export type SendCapReason = 'allowed' | 'cooldown' | 'daily_cap' | 'redis_unreachable';

export interface SendSlotResult {
  allowed: boolean;
  cooldownSeconds: number;
  dailyCount: number;
  reason?: SendCapReason;
}

const SEND_CAP_LUA = `
local cooldownKey = KEYS[1]
local dailyKey = KEYS[2]
local cooldownSeconds = tonumber(ARGV[1])
local dailyCap = tonumber(ARGV[2])
local dailyTtl = tonumber(ARGV[3])

-- 1. Check if cooldown is active
local cooldownTtl = redis.call('TTL', cooldownKey)
if cooldownTtl > 0 then
  local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
  return { 0, 'cooldown', cooldownTtl, currentDaily }
end

-- 2. Check if daily send cap is reached
local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
if currentDaily >= dailyCap then
  return { 0, 'daily_cap', 0, currentDaily }
end

-- 3. Allowed: atomically set cooldown key
redis.call('SET', cooldownKey, '1', 'EX', cooldownSeconds)

-- 4. Atomically increment daily counter and ensure TTL is set
local nextDaily = redis.call('INCR', dailyKey)
local currentTtl = redis.call('TTL', dailyKey)
if currentTtl == -1 or nextDaily == 1 then
  redis.call('EXPIRE', dailyKey, dailyTtl)
end

return { 1, 'allowed', cooldownSeconds, nextDaily }
`;

/**
 * Checks and increments the per-email send cap and cooldown atomically in Redis.
 * If Redis is unreachable, logs error class only, returns allowed: false (sending no mail),
 * allowing caller to return normal success response without throwing 500 (Task 2).
 */
export async function consumeEmailSendSlot(email: string): Promise<SendSlotResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const cooldownKey = `email_cooldown:${normalizedEmail}`;
  const dailyKey = `email_daily_count:${normalizedEmail}`;
  const dailyTtlSeconds = 86400; // 24-hour daily window

  try {
    const redis = getRedisClient();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => {});
    }

    const rawResult = await redis.eval(
      SEND_CAP_LUA,
      2,
      cooldownKey,
      dailyKey,
      env.CODE_RESEND_COOLDOWN_SECONDS,
      env.DAILY_CODE_SEND_CAP,
      dailyTtlSeconds,
    );

    const isArray = Array.isArray(rawResult);
    const allowed = isArray && rawResult[0] === 1;
    const rawReason = isArray ? String(rawResult[1]) : '';
    const cooldownSeconds = isArray ? Number(rawResult[2]) || env.CODE_RESEND_COOLDOWN_SECONDS : env.CODE_RESEND_COOLDOWN_SECONDS;
    const dailyCount = isArray ? Number(rawResult[3]) || 0 : 0;

    let reason: SendCapReason | undefined;
    if (rawReason === 'cooldown' || rawReason === 'daily_cap' || rawReason === 'allowed') {
      reason = rawReason;
    }

    return {
      allowed,
      cooldownSeconds,
      dailyCount,
      reason: allowed ? undefined : reason,
    };
  } catch (err: unknown) {
    const errorClass = err instanceof Error ? err.name : 'Error';
    // Task 2: Log one line (error class only, never recipient or values)
    process.stderr.write(`[SendCap Error] ${errorClass}\n`);
    // If Redis is unreachable: send no mail, return allowed: false
    return {
      allowed: false,
      cooldownSeconds: env.CODE_RESEND_COOLDOWN_SECONDS,
      dailyCount: 0,
      reason: 'redis_unreachable',
    };
  }
}

/**
 * Resets send cap tracking for an email (used in test cleanups).
 */
export async function resetSendCap(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const redis = getRedisClient();
    await redis.del(`email_cooldown:${normalizedEmail}`);
    await redis.del(`email_daily_count:${normalizedEmail}`);
  } catch {
    // Ignore
  }
}
