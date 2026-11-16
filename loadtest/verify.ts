/**
 * A VUE Load-Test Post-Run Verification Script
 * Validates system state after the 500-VU hold race.
 * Rule 02 (Security), Rule 04 (Traffic)
 *
 * Checks:
 *   (1) No seat has more than one active hold (single-holder invariant).
 *   (2) Number of held or sold seats is at most 50 (no capacity overflow).
 *   (3) Count of active waiting-room entries is at most WAITING_ROOM_ACTIVE_LIMIT.
 *
 * Usage:
 *   $env:SHOWTIME_ID="<showtime_uuid>"
 *   npx tsx loadtest/verify.ts
 */

import { env } from '../server/src/env.js';
import { query, writerPool } from '../server/src/lib/db.js';
import { getRedisClient } from '../server/src/lib/redis.js';
import { assertLocalhostEnvironment } from '../server/scripts/loadtest-config.js';

interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

async function verify(): Promise<void> {
  assertLocalhostEnvironment();

  const showtimeId = process.argv[2] || process.env.SHOWTIME_ID;
  if (!showtimeId) {
    console.error('[Verify Error] SHOWTIME_ID is required. Set env SHOWTIME_ID or pass as argument.');
    process.exit(1);
  }

  console.log(`[Verify] Running load-test verification for showtime: ${showtimeId}`);
  console.log(`[Verify] Environment safety checks passed (localhost only).\n`);

  const results: CheckResult[] = [];
  const redis = getRedisClient();
  if (redis.status !== 'ready') {
    await redis.connect().catch(() => {});
  }

  try {
    // ------------------------------------------------------------------------
    // CHECK 1: No seat has more than one active hold
    // ------------------------------------------------------------------------
    const holdKeys = await redis.keys(`hold:${showtimeId}:*`);
    const seatHolderMap = new Map<string, string>();
    let duplicateHoldFound = false;
    let duplicateSeatId = '';

    for (const key of holdKeys) {
      // Key format: hold:<showtimeId>:<seatId>
      const parts = key.split(':');
      const seatId = parts[2];
      const holder = await redis.get(key);

      if (holder) {
        if (seatHolderMap.has(seatId) && seatHolderMap.get(seatId) !== holder) {
          duplicateHoldFound = true;
          duplicateSeatId = seatId;
          break;
        }
        seatHolderMap.set(seatId, holder);
      }
    }

    // Check DB bookings for double-sold seats
    const dbDuplicateRes = await query<{ seat_id: string; count: string }>(
      `SELECT seat_id, count(*)::text AS count
       FROM bookings
       WHERE showtime_id = $1 AND status = 'confirmed'
       GROUP BY seat_id
       HAVING count(*) > 1;`,
      [showtimeId]
    );

    const hasDbDoubleBooking = dbDuplicateRes.rows.length > 0;
    const check1Passed = !duplicateHoldFound && !hasDbDoubleBooking;

    results.push({
      name: 'Check 1: No seat has more than one active hold',
      passed: check1Passed,
      details: check1Passed
        ? `Zero double-holds detected across ${holdKeys.length} active holds and 0 DB double-bookings.`
        : `Duplicate hold detected for seat: ${duplicateSeatId || dbDuplicateRes.rows[0]?.seat_id}`,
    });

    // ------------------------------------------------------------------------
    // CHECK 2: Number of held or sold seats is at most 50
    // ------------------------------------------------------------------------
    const heldCount = holdKeys.length;

    const dbSoldRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM bookings
       WHERE showtime_id = $1 AND status = 'confirmed';`,
      [showtimeId]
    );
    const dbSoldCount = dbSoldRes.rows[0]?.count || 0;

    const redisSoldKeys = await redis.keys(`sold:${showtimeId}:*`);
    const redisSoldCount = redisSoldKeys.length;
    const totalSoldCount = Math.max(dbSoldCount, redisSoldCount);

    const totalHeldOrSold = heldCount + totalSoldCount;
    const check2Passed = totalHeldOrSold <= 50;

    results.push({
      name: 'Check 2: Number of held or sold seats is at most 50',
      passed: check2Passed,
      details: `Total held or sold: ${totalHeldOrSold} / 50 (Active holds: ${heldCount}, Confirmed sold: ${totalSoldCount}).`,
    });

    // ------------------------------------------------------------------------
    // CHECK 3: Count of active waiting-room entries <= WAITING_ROOM_ACTIVE_LIMIT
    // ------------------------------------------------------------------------
    const activeKey = `wr:${showtimeId}:active`;
    const rawActiveEntries = await redis.hgetall(activeKey);
    const now = Date.now();
    const slotMs = env.WAITING_ROOM_SLOT_SECONDS * 1000;
    const cutoff = now - slotMs;

    // Filter unexpired active entries
    let activeUnexpiredCount = 0;
    for (const tsStr of Object.values(rawActiveEntries)) {
      if (Number(tsStr) > cutoff) {
        activeUnexpiredCount += 1;
      }
    }

    const rawActiveCount = Object.keys(rawActiveEntries).length;
    const limit = env.WAITING_ROOM_ACTIVE_LIMIT;
    const check3Passed = activeUnexpiredCount <= limit;

    results.push({
      name: 'Check 3: Count of active waiting-room entries <= WAITING_ROOM_ACTIVE_LIMIT',
      passed: check3Passed,
      details: `Active waiting room entries: ${activeUnexpiredCount} (raw in hash: ${rawActiveCount}), configured limit: ${limit}.`,
    });

    // ------------------------------------------------------------------------
    // Print Summary
    // ------------------------------------------------------------------------
    console.log('='.repeat(70));
    console.log('A VUE LOAD-TEST VERIFICATION REPORT');
    console.log('='.repeat(70));

    let allPassed = true;
    for (const r of results) {
      const tag = r.passed ? 'PASS' : 'FAIL';
      console.log(`[${tag}] ${r.name}`);
      console.log(`       ${r.details}`);
      if (!r.passed) allPassed = false;
    }

    console.log('='.repeat(70));
    console.log(`OVERALL RESULT: ${allPassed ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(70));

    if (!allPassed) {
      process.exit(1);
    }
  } finally {
    redis.disconnect();
    await writerPool.end();
  }
}

if (process.argv[1] && process.argv[1].includes('verify')) {
  verify()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[Verification Error] ${err.message}`);
      process.exit(1);
    });
}

export { verify };
