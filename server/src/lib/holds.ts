/**
 * A VUE Redis Seat Holds Module
 * Implements atomic seat holds, all-or-nothing multi-seat reservation via Lua,
 * compare-and-delete release, seat-map caching, and fail-closed Redis resilience.
 * (Rule 04 / Task 3 & 4)
 */

import { env } from '../env.js';
import { writerPool } from './db.js';
import { getRedisClient } from './redis.js';

// Multi-seat hold Lua script: atomic all-or-nothing check and acquisition
const HOLD_SEATS_LUA = `
for i = 1, #KEYS do
  local seatId = ARGV[3 + i]
  local soldKey = "sold:" .. ARGV[3] .. ":" .. seatId
  if redis.call("EXISTS", soldKey) == 1 then
    return -1 -- Seat already permanently sold
  end
  local holder = redis.call("GET", KEYS[i])
  if holder and holder ~= ARGV[1] then
    return 0 -- Held by another user
  end
end
for i = 1, #KEYS do
  redis.call("SET", KEYS[i], ARGV[1], "EX", tonumber(ARGV[2]))
end
return 1
`;

// Owner-only compare-and-delete release script
const RELEASE_SEATS_LUA = `
local released = 0
for i = 1, #KEYS do
  if redis.call("GET", KEYS[i]) == ARGV[1] then
    redis.call("DEL", KEYS[i])
    released = released + 1
  end
end
return released
`;

// Verification script: checks if user currently holds every specified seat
const VERIFY_USER_HOLDS_LUA = `
for i = 1, #KEYS do
  if redis.call("GET", KEYS[i]) ~= ARGV[1] then
    return 0
  end
end
return 1
`;

export interface SeatMapItem {
  id: string;
  row: string;
  number: number;
  accessible: boolean;
  state: 'available' | 'held' | 'sold';
}

export interface SeatMapResult {
  showtimeId: string;
  hallId: string;
  totalSeats: number;
  seats: SeatMapItem[];
  cachedAt?: string;
}

export interface HoldResult {
  status: 'acquired' | 'conflict_held' | 'conflict_sold';
  heldCount: number;
  expiresAt?: string;
}

/**
 * Retrieves the seat map for a showtime.
 * Blends:
 * 1. Static hall seating geometry from DB
 * 2. Confirmed bookings from DB ('sold')
 * 3. Redis permanent sold markers ('sold')
 * 4. Redis active temporary holds ('held')
 * Caches complete payload in Redis for 2 seconds (SEAT_MAP_CACHE_SECONDS).
 */
export async function getSeatMap(showtimeId: string): Promise<SeatMapResult> {
  const redis = getRedisClient();
  const cacheKey = `cache:seatmap:${showtimeId}`;

  // 1. Check Redis cache
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => { });
    }
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err: any) {
    process.stderr.write(`[SeatMap Warning] Redis cache read error: ${err.message}\n`);
  }

  // 2. Fetch seating layout & showtime details from DB
  const pool = writerPool;
  const showtimeRes = await pool.query(
    `SELECT s.id, s.screen_id, s.hall_id, COALESCE(h.total_seats, sc.total_seats) as total_seats
     FROM showtimes s
     LEFT JOIN halls h ON h.id = COALESCE(s.hall_id, s.screen_id)
     LEFT JOIN screens sc ON sc.id = COALESCE(s.hall_id, s.screen_id)
     WHERE s.id = $1`,
    [showtimeId]
  );

  if (showtimeRes.rows.length === 0) {
    throw new Error('SHOWTIME_NOT_FOUND');
  }

  const showtime = showtimeRes.rows[0];
  const hallId = showtime.hall_id || showtime.screen_id;

  // 3. Fetch all seats for this hall
  const seatsRes = await pool.query(
    `SELECT id, COALESCE("row", row_label) as row_label, COALESCE("number", seat_number) as seat_num, accessible, seat_type
     FROM seats
     WHERE screen_id = $1 OR hall_id = $1
     ORDER BY row_label ASC, seat_num ASC`,
    [hallId]
  );

  // 4. Fetch confirmed bookings for this showtime from DB
  const bookingsRes = await pool.query(
    `SELECT seat_id FROM bookings WHERE showtime_id = $1 AND status = 'confirmed'`,
    [showtimeId]
  );
  const dbSoldSeatIds = new Set<string>(bookingsRes.rows.map((r: any) => r.seat_id));

  // 5. Query active Redis holds and sold markers for each seat
  const seatItems: SeatMapItem[] = [];

  try {
    const pipe = redis.pipeline();
    for (const seat of seatsRes.rows) {
      pipe.get(`hold:${showtimeId}:${seat.id}`);
      pipe.exists(`sold:${showtimeId}:${seat.id}`);
    }
    const redisResults = await pipe.exec();

    seatsRes.rows.forEach((seat: any, idx: number) => {
      const isDbSold = dbSoldSeatIds.has(seat.id);
      const isRedisSold = redisResults && redisResults[idx * 2 + 1]?.[1] === 1;
      const holdValue = redisResults && redisResults[idx * 2]?.[1];

      let state: 'available' | 'held' | 'sold' = 'available';
      if (isDbSold || isRedisSold) {
        state = 'sold';
      } else if (holdValue) {
        state = 'held';
      }

      seatItems.push({
        id: seat.id,
        row: seat.row_label,
        number: Number(seat.seat_num),
        accessible: Boolean(seat.accessible || seat.seat_type === 'wheelchair'),
        state,
      });
    });
  } catch (err: any) {
    // If Redis pipeline fails, fall back to DB sold markers only
    process.stderr.write(`[SeatMap Warning] Redis offline during seat status query: ${err.message}\n`);
    seatsRes.rows.forEach((seat: any) => {
      seatItems.push({
        id: seat.id,
        row: seat.row_label,
        number: Number(seat.seat_num),
        accessible: Boolean(seat.accessible || seat.seat_type === 'wheelchair'),
        state: dbSoldSeatIds.has(seat.id) ? 'sold' : 'available',
      });
    });
  }

  const result: SeatMapResult = {
    showtimeId,
    hallId,
    totalSeats: seatItems.length,
    seats: seatItems,
    cachedAt: new Date().toISOString(),
  };

  // 6. Cache the computed seat map in Redis for 2 seconds
  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', env.SEAT_MAP_CACHE_SECONDS);
  } catch {
    // Non-fatal cache write failure
  }

  return result;
}

/**
 * Attempts to acquire atomic all-or-nothing holds on a set of seats.
 * Enforces:
 * - Max seats per hold (default 6)
 * - Lua atomic check against sold markers and other users' holds
 * - Fails closed (503) if Redis is down
 */
export async function holdSeats(
  showtimeId: string,
  seatIds: string[],
  userId: string
): Promise<HoldResult> {
  if (seatIds.length === 0 || seatIds.length > env.MAX_SEATS_PER_HOLD) {
    throw new Error('INVALID_SEAT_COUNT');
  }

  const redis = getRedisClient();
  if (redis.status !== 'ready') {
    await redis.connect().catch(() => { });
  }

  const keys = seatIds.map((id) => `hold:${showtimeId}:${id}`);
  const args = [
    userId,
    String(env.HOLD_TTL_SECONDS),
    showtimeId,
    ...seatIds,
  ];

  try {
    const outcome = (await redis.eval(
      HOLD_SEATS_LUA,
      keys.length,
      ...keys,
      ...args
    )) as number;

    if (outcome === 1) {
      const expiresAt = new Date(Date.now() + env.HOLD_TTL_SECONDS * 1000).toISOString();
      // Invalidate cached seat map so next poll sees new holds
      await redis.del(`cache:seatmap:${showtimeId}`).catch(() => { });
      return {
        status: 'acquired',
        heldCount: seatIds.length,
        expiresAt,
      };
    }

    if (outcome === -1) {
      return {
        status: 'conflict_sold',
        heldCount: 0,
      };
    }

    return {
      status: 'conflict_held',
      heldCount: 0,
    };
  } catch (err: any) {
    process.stderr.write(`[Hold Error] Redis failure during hold acquisition: ${err.message}\n`);
    throw new Error('REDIS_UNAVAILABLE');
  }
}

/**
 * Releases seats held by this user via compare-and-delete Lua script.
 * Never releases a seat held by another user.
 */
export async function releaseSeats(
  showtimeId: string,
  seatIds: string[] | undefined,
  userId: string
): Promise<number> {
  const redis = getRedisClient();

  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => { });
    }

    let targetKeys: string[] = [];
    if (seatIds && seatIds.length > 0) {
      targetKeys = seatIds.map((id) => `hold:${showtimeId}:${id}`);
    } else {
      // Find all keys for this showtime held by this user
      const keys = await redis.keys(`hold:${showtimeId}:*`);
      targetKeys = keys;
    }

    if (targetKeys.length === 0) {
      return 0;
    }

    const released = (await redis.eval(
      RELEASE_SEATS_LUA,
      targetKeys.length,
      ...targetKeys,
      userId
    )) as number;

    // Invalidate cached seat map
    await redis.del(`cache:seatmap:${showtimeId}`).catch(() => { });
    return released;
  } catch (err: any) {
    process.stderr.write(`[Hold Error] Redis release failure: ${err.message}\n`);
    throw new Error('REDIS_UNAVAILABLE');
  }
}

/**
 * Verifies that the specified user still holds every seat in the list.
 */
export async function verifyUserHolds(
  showtimeId: string,
  seatIds: string[],
  userId: string
): Promise<boolean> {
  const redis = getRedisClient();
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => { });
    }

    const keys = seatIds.map((id) => `hold:${showtimeId}:${id}`);
    const result = (await redis.eval(
      VERIFY_USER_HOLDS_LUA,
      keys.length,
      ...keys,
      userId
    )) as number;

    return result === 1;
  } catch (err: any) {
    process.stderr.write(`[Hold Error] Redis verify holds failure: ${err.message}\n`);
    return false;
  }
}

/**
 * Releases ALL seats held by this user across any active showtime.
 * Used during account deletion (Task 4) and session teardown.
 */
export async function releaseAllUserHolds(userId: string): Promise<number> {
  const redis = getRedisClient();
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => {});
    }
    const keys = await redis.keys('hold:*');
    if (keys.length === 0) return 0;

    const released = (await redis.eval(
      RELEASE_SEATS_LUA,
      keys.length,
      ...keys,
      userId
    )) as number;
    return released;
  } catch (err: any) {
    process.stderr.write(`[Hold Error] Failed to release all user holds: ${err.message}\n`);
    return 0;
  }
}

/**
 * Writes permanent sold markers in Redis (no TTL) and removes temporary holds.
 * (Rule 04: "On payment, write a permanent sold marker before removing the hold key")
 */
export async function markSeatsSold(
  showtimeId: string,
  seatIds: string[],
  userId: string
): Promise<void> {
  const redis = getRedisClient();
  try {
    const pipe = redis.pipeline();
    for (const seatId of seatIds) {
      pipe.set(`sold:${showtimeId}:${seatId}`, userId);
      pipe.del(`hold:${showtimeId}:${seatId}`);
    }
    pipe.del(`cache:seatmap:${showtimeId}`);
    await pipe.exec();
  } catch (err: any) {
    process.stderr.write(`[Hold Error] Failed to write permanent sold markers: ${err.message}\n`);
  }
}

