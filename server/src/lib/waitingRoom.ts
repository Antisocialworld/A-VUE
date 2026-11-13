/**
 * A VUE Waiting Room Module
 * Implements serverless lazy queue admission when concurrent users exceed WAITING_ROOM_ACTIVE_LIMIT.
 * (Rule 04 / Task 5)
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
 * Checks the user's status in the showtime waiting room.
 * Admits user if active limit is not exceeded, or returns queue position.
 */
export async function getWaitingRoomStatus(
  showtimeId: string,
  userId: string
): Promise<WaitingRoomStatus> {
  const redis = getRedisClient();
  if (redis.status !== 'ready') {
    await redis.connect().catch(() => {});
  }

  const now = Date.now();
  const activeLimit = env.WAITING_ROOM_ACTIVE_LIMIT; // default 100
  const admitPerSec = env.WAITING_ROOM_ADMIT_PER_SEC; // default 5
  const slotSeconds = env.WAITING_ROOM_SLOT_SECONDS; // default 90s

  const activeKey = `wr:${showtimeId}:active`;
  const queueKey = `wr:${showtimeId}:queue`;
  const passKey = `wr:${showtimeId}:pass:${userId}`;

  // 1. Check if user already holds a valid unexpired admission pass
  const existingPass = await redis.get(passKey);
  if (existingPass) {
    // Refresh activity in active set
    await redis.hset(activeKey, userId, String(now));
    return {
      status: 'admitted',
      pass: existingPass,
    };
  }

  // 2. Clean stale users from active set (> slotSeconds old)
  const activeEntries = await redis.hgetall(activeKey);
  const cutoff = now - slotSeconds * 1000;
  const staleUserIds: string[] = [];

  for (const [uid, timestampStr] of Object.entries(activeEntries)) {
    if (Number(timestampStr) < cutoff) {
      staleUserIds.push(uid);
    }
  }

  if (staleUserIds.length > 0) {
    await redis.hdel(activeKey, ...staleUserIds);
  }

  const currentActiveCount = Object.keys(activeEntries).length - staleUserIds.length;

  // 3. Process lazy admission from queue if capacity is available
  const availableSlots = Math.max(0, activeLimit - currentActiveCount);
  if (availableSlots > 0) {
    // Pop top candidates from sorted set
    const candidates = await redis.zrange(queueKey, 0, availableSlots - 1);
    if (candidates.length > 0) {
      const pipe = redis.pipeline();
      pipe.zrem(queueKey, ...candidates);
      for (const candidate of candidates) {
        const pass = crypto.randomBytes(16).toString('hex');
        pipe.hset(activeKey, candidate, String(now));
        pipe.set(`wr:${showtimeId}:pass:${candidate}`, pass, 'EX', slotSeconds);
      }
      await pipe.exec();

      // If our current user was in the admitted candidates
      if (candidates.includes(userId)) {
        const freshPass = await redis.get(passKey);
        return {
          status: 'admitted',
          pass: freshPass || undefined,
        };
      }
    }
  }

  // 4. If current active count is still under active limit and queue is empty, admit immediately
  const queueLength = await redis.zcard(queueKey);
  if (currentActiveCount < activeLimit && queueLength === 0) {
    const pass = crypto.randomBytes(16).toString('hex');
    const pipe = redis.pipeline();
    pipe.hset(activeKey, userId, String(now));
    pipe.set(passKey, pass, 'EX', slotSeconds);
    await pipe.exec();

    return {
      status: 'admitted',
      pass,
    };
  }

  // 5. User must queue: add to sorted set
  await redis.zadd(queueKey, 'NX', now, userId);
  const rank = await redis.zrank(queueKey, userId);
  const position = rank !== null ? rank + 1 : 1;
  const estimatedWaitSeconds = Math.ceil(position / admitPerSec);

  return {
    status: 'queued',
    position,
    estimatedWaitSeconds,
  };
}

/**
 * Validates whether a user is authorized to hold seats.
 * Returns true if:
 * 1. The user holds a valid admission pass in Redis, OR
 * 2. The waiting room for this showtime is inactive (active users < limit and no queue).
 */
export async function isAdmittedOrRoomInactive(
  showtimeId: string,
  userId: string,
  presentedPass?: string
): Promise<boolean> {
  const redis = getRedisClient();
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => {});
    }

    // Check pass
    if (presentedPass) {
      const storedPass = await redis.get(`wr:${showtimeId}:pass:${userId}`);
      if (storedPass && storedPass === presentedPass) {
        return true;
      }
    }

    // Check if room has reached capacity
    const activeCount = await redis.hlen(`wr:${showtimeId}:active`);
    const queueCount = await redis.zcard(`wr:${showtimeId}:queue`);

    if (activeCount < env.WAITING_ROOM_ACTIVE_LIMIT && queueCount === 0) {
      return true; // Room inactive, direct hold allowed
    }

    return false;
  } catch (err: any) {
    process.stderr.write(`[WaitingRoom Warning] Redis offline during admission check: ${err.message}\n`);
    // Fail closed: if Redis is down, waiting room fails closed
    return false;
  }
}

