/**
 * A VUE Waiting Room Module
 * Implements serverless atomic queue admission and capacity control via Redis Lua script.
 * (Rule 04 / Task 5 & Waiting Room Hardening)
 */

import crypto from 'node:crypto';
import { env } from '../env.js';
import { getRedisClient } from './redis.js';

export interface WaitingRoomStatus {
  status: 'admitted' | 'queued';
  pass?: string;
  position?: number;
  estimatedWaitSeconds?: number;
}

/**
 * Single atomic check-in Lua script.
 * KEYS[1]: wr:<showtimeId>:active (Hash mapping userId -> timestampMs)
 * KEYS[2]: wr:<showtimeId>:queue (Sorted Set mapping userId -> score timestampMs)
 * ARGV[1]: userId
 * ARGV[2]: now (timestampMs)
 * ARGV[3]: activeLimit
 * ARGV[4]: slotSeconds
 */
const CHECK_IN_LUA = `
local activeKey = KEYS[1]
local queueKey = KEYS[2]

local userId = ARGV[1]
local now = tonumber(ARGV[2])
local activeLimit = tonumber(ARGV[3])
local slotSeconds = tonumber(ARGV[4])
local slotMs = slotSeconds * 1000
local cutoff = now - slotMs

-- 1. If userId is in the active hash and not stale, refresh its timestamp and return admitted.
local existingActive = redis.call("HGET", activeKey, userId)
if existingActive then
  local ts = tonumber(existingActive)
  if ts and ts >= cutoff then
    redis.call("HSET", activeKey, userId, now)
    return { "admitted", 0 }
  end
end

-- 2. Remove stale active entries (older than slotSeconds).
local allActive = redis.call("HGETALL", activeKey)
for i = 1, #allActive, 2 do
  local uid = allActive[i]
  local ts = tonumber(allActive[i + 1])
  if ts and ts < cutoff then
    redis.call("HDEL", activeKey, uid)
  end
end

local activeCount = redis.call("HLEN", activeKey)

-- 3. Admit from the FRONT of the queue (lowest score) into the active hash, up to the free slots.
local freeSlots = activeLimit - activeCount
local admittedInStep3 = false

if freeSlots > 0 then
  local candidates = redis.call("ZRANGE", queueKey, 0, freeSlots - 1)
  if #candidates > 0 then
    for _, cand in ipairs(candidates) do
      redis.call("ZREM", queueKey, cand)
      redis.call("HSET", activeKey, cand, now)
      if cand == userId then
        admittedInStep3 = true
      end
    end
    activeCount = activeCount + #candidates
  end
end

-- 4. If the caller was admitted in step 3, return admitted.
if admittedInStep3 then
  return { "admitted", 0 }
end

-- 5. If the caller is not queued, active count < limit and the queue is empty, add the caller to active and return admitted.
local callerRank = redis.call("ZRANK", queueKey, userId)
local queueLength = redis.call("ZCARD", queueKey)

if callerRank == false and activeCount < activeLimit and queueLength == 0 then
  redis.call("HSET", activeKey, userId, now)
  return { "admitted", 0 }
end

-- 6. Otherwise ZADD NX the caller to the queue and return queued with position (rank + 1).
redis.call("ZADD", queueKey, "NX", now, userId)
local rank = redis.call("ZRANK", queueKey, userId)
local position = (rank and (rank + 1)) or 1
return { "queued", position }
`;

/**
 * Atomic check-in for waiting room admission.
 * Runs single EVAL script that manages active pool and queue.
 * Membership in active hash is the single source of truth for admission.
 */
export async function checkInWaitingRoom(
  showtimeId: string,
  userId: string
): Promise<WaitingRoomStatus> {
  const redis = getRedisClient();
  if (redis.status !== 'ready') {
    await redis.connect().catch(() => {});
  }

  const now = Date.now();
  const activeLimit = env.WAITING_ROOM_ACTIVE_LIMIT;
  const slotSeconds = env.WAITING_ROOM_SLOT_SECONDS;

  const activeKey = `wr:${showtimeId}:active`;
  const queueKey = `wr:${showtimeId}:queue`;

  const [status, position] = (await redis.eval(
    CHECK_IN_LUA,
    2,
    activeKey,
    queueKey,
    userId,
    String(now),
    String(activeLimit),
    String(slotSeconds)
  )) as [string, number];

  if (status === 'admitted') {
    // Return opaque random token via crypto.randomBytes to preserve app contract (never stored, never checked)
    const pass = crypto.randomBytes(16).toString('hex');
    return {
      status: 'admitted',
      pass,
    };
  }

  const admitPerSec = env.WAITING_ROOM_ADMIT_PER_SEC;
  const estimatedWaitSeconds = Math.ceil(position / admitPerSec);

  return {
    status: 'queued',
    position,
    estimatedWaitSeconds,
  };
}

/**
 * Checks the user's status in the showtime waiting room.
 * Delegates to checkInWaitingRoom to avoid duplicate logic.
 */
export async function getWaitingRoomStatus(
  showtimeId: string,
  userId: string
): Promise<WaitingRoomStatus> {
  return checkInWaitingRoom(showtimeId, userId);
}
