/**
 * A VUE Load-Test Cleanup Script
 * Cleans up loadtest users, their sessions, Redis holds, and waiting room keys.
 * Rule 02 (Security), Rule 04 (Traffic)
 *
 * Guarantees:
 * - Refuses to execute in production environment.
 * - Refuses to execute unless DATABASE_URL and REDIS_URL hosts are localhost or 127.0.0.1.
 * - Deletes loadtest users and associated sessions.
 * - Clears Redis hold keys (hold:*) and waiting-room keys (wr:*).
 * - Prints only counts to stdout; never prints credentials or tokens.
 *
 * Usage:
 *   npx tsx scripts/loadtest-cleanup.ts [optional_showtime_id]
 */

import { writerPool } from '../src/lib/db.js';
import { getRedisClient } from '../src/lib/redis.js';
import {
  assertLocalhostEnvironment,
  LOADTEST_EMAIL_DOMAIN,
  LOADTEST_EMAIL_PREFIX,
} from './loadtest-config.js';

async function cleanup(): Promise<void> {
  assertLocalhostEnvironment();

  const showtimeId = process.argv[2] || process.env.SHOWTIME_ID;
  const emailPattern = `${LOADTEST_EMAIL_PREFIX}%${LOADTEST_EMAIL_DOMAIN}`;

  console.log(`[LoadTest Cleanup] Safety checks passed (localhost only).`);
  console.log(`[LoadTest Cleanup] Starting cleanup of load test data...`);

  // 1. Clean Database (Sessions, Bookings, Users)
  const client = await writerPool.connect();
  let deletedSessions = 0;
  let deletedUsers = 0;

  try {
    await client.query('BEGIN');

    // Clean any user-dependent records if any were created during tests
    await client.query(
      `DELETE FROM idempotency_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1);`,
      [emailPattern]
    );
    await client.query(
      `DELETE FROM tickets WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1);`,
      [emailPattern]
    );
    await client.query(
      `DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1);`,
      [emailPattern]
    );
    await client.query(
      `DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1);`,
      [emailPattern]
    );

    // Delete sessions
    const sessRes = await client.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1);`,
      [emailPattern]
    );
    deletedSessions = sessRes.rowCount || 0;

    // Delete users
    const userRes = await client.query(
      `DELETE FROM users WHERE email LIKE $1;`,
      [emailPattern]
    );
    deletedUsers = userRes.rowCount || 0;

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await writerPool.end();
  }

  // 2. Clean Redis Keys (Holds and Waiting Room)
  const redis = getRedisClient();
  if (redis.status !== 'ready') {
    await redis.connect().catch(() => {});
  }

  let deletedRedisKeys = 0;

  try {
    const patterns = showtimeId
      ? [
          `hold:${showtimeId}:*`,
          `wr:${showtimeId}:*`,
          `cache:seatmap:${showtimeId}`,
          `sold:${showtimeId}:*`,
        ]
      : ['hold:*', 'wr:*', 'cache:seatmap:*'];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        const count = await redis.del(...keys);
        deletedRedisKeys += count;
      }
    }
  } catch (err: any) {
    console.error(`[LoadTest Cleanup Warning] Redis cleanup warning: ${err.message}`);
  } finally {
    redis.disconnect();
  }

  console.log(`[LoadTest Cleanup] Completed successfully:`);
  console.log(`  - Deleted user sessions: ${deletedSessions}`);
  console.log(`  - Deleted loadtest users: ${deletedUsers}`);
  console.log(`  - Deleted Redis hold/waiting-room keys: ${deletedRedisKeys}`);
}

if (process.argv[1] && process.argv[1].includes('loadtest-cleanup')) {
  cleanup()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[LoadTest Cleanup Error] ${err.message}`);
      process.exit(1);
    });
}

export { cleanup };
