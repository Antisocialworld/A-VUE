/**
 * A VUE Load-Test User Seed Script
 * Provisions 500 verified test user accounts: loadtest+<n>@loadtest.invalid (n=1..500).
 * Rule 02 (Security), Rule 04 (Traffic)
 *
 * Guarantees:
 * - Refuses to execute in production environment.
 * - Refuses to execute unless DATABASE_URL and REDIS_URL hosts are localhost or 127.0.0.1.
 * - Passwords hashed with existing Argon2id helper (hashArgon2id).
 * - Password retrieved exclusively from env LOADTEST_PASSWORD at runtime.
 * - Never prints, hardcodes, or logs secrets or credentials.
 * - Idempotent execution: leverages PostgreSQL UNIQUE constraint on email.
 * - Prints only counts to stdout.
 *
 * Usage:
 *   $env:LOADTEST_PASSWORD="YourSecurePasswordHere"
 *   npx tsx scripts/loadtest-seed.ts
 */

import { hashArgon2id } from '../src/lib/argon2.js';
import { writerPool } from '../src/lib/db.js';
import {
  assertLocalhostEnvironment,
  getLoadTestPassword,
  LOADTEST_EMAIL_DOMAIN,
  LOADTEST_EMAIL_PREFIX,
  LOADTEST_USER_COUNT,
} from './loadtest-config.js';

async function seed(): Promise<void> {
  assertLocalhostEnvironment();
  const password = getLoadTestPassword();

  console.log(`[LoadTest Seed] Safety checks passed (localhost only).`);
  console.log(`[LoadTest Seed] Computing Argon2id password hash for load test users...`);
  const passwordHash = await hashArgon2id(password);

  console.log(`[LoadTest Seed] Inserting ${LOADTEST_USER_COUNT} users...`);
  const client = await writerPool.connect();

  try {
    await client.query('BEGIN');

    // Bulk insert with generate_series using the unique constraint on email
    await client.query(
      `INSERT INTO users (email, password_hash, status)
       SELECT
         $1 || n || $2,
         $3,
         'active'
       FROM generate_series(1, $4::int) AS n
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         status = 'active',
         deleted_at = NULL,
         purge_after = NULL;`,
      [LOADTEST_EMAIL_PREFIX, LOADTEST_EMAIL_DOMAIN, passwordHash, LOADTEST_USER_COUNT]
    );

    await client.query('COMMIT');

    // Query active count
    const countRes = await client.query(
      `SELECT count(*)::int AS count
       FROM users
       WHERE email LIKE $1 AND status = 'active';`,
      [`${LOADTEST_EMAIL_PREFIX}%${LOADTEST_EMAIL_DOMAIN}`]
    );

    const totalActive = countRes.rows[0]?.count || 0;

    console.log(`[LoadTest Seed] Completed successfully.`);
    console.log(`  - Total active loadtest users in database: ${totalActive}`);
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await writerPool.end();
  }
}

if (process.argv[1] && process.argv[1].includes('loadtest-seed')) {
  seed()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[LoadTest Seed Error] ${err.message}`);
      process.exit(1);
    });
}

export { seed };
