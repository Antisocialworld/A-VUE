/**
 * A VUE Load-Test Session Token Minter
 * Pre-generates authenticated session tokens for the 500 seeded load-test users.
 * Rule 02 (Security), Rule 04 (Traffic)
 *
 * Guarantees:
 * - Refuses to execute in production.
 * - Refuses to execute unless DATABASE_URL and REDIS_URL hosts are localhost or 127.0.0.1.
 * - Refuses to execute if LOADTEST_TOKENS_FILE is unset or inside the repository directory.
 * - Mints real sessions using the application's createSession() function (Argon2id-hashed secrets in DB).
 * - Writes a JSON array of 500 session tokens (index n-1 for user n) to LOADTEST_TOKENS_FILE.
 * - Idempotent: deletes old sessions for loadtest users before minting new ones.
 * - Never prints tokens or credentials to stdout; prints counts only.
 *
 * Usage:
 *   $env:LOADTEST_TOKENS_FILE = "$env:TEMP\loadtest-tokens.json"
 *   npx tsx scripts/loadtest-tokens.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writerPool } from '../src/lib/db.js';
import { createSession } from '../src/lib/session.js';
import {
  assertLocalhostEnvironment,
  getLoadTestEmail,
  LOADTEST_EMAIL_DOMAIN,
  LOADTEST_EMAIL_PREFIX,
  LOADTEST_USER_COUNT,
} from './loadtest-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function mintTokens(): Promise<void> {
  // 1. Safety verification (localhost only)
  assertLocalhostEnvironment();

  // 2. Validate LOADTEST_TOKENS_FILE target path
  const tokensFilePath = process.env.LOADTEST_TOKENS_FILE;
  if (!tokensFilePath || !tokensFilePath.trim()) {
    throw new Error(
      '[FATAL] LOADTEST_TOKENS_FILE environment variable is required at runtime.'
    );
  }

  const resolvedPath = path.resolve(tokensFilePath);
  const repoRoot = path.resolve(__dirname, '../../');
  const relativeToRepo = path.relative(repoRoot, resolvedPath);

  // Path is inside repo if relative path does not navigate out (doesn't start with '..') and is not absolute
  const isInsideRepo = !relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo);
  if (isInsideRepo) {
    throw new Error(
      `[FATAL] Refusing to write load-test tokens inside the repository folder. Output path: ${resolvedPath}. Set LOADTEST_TOKENS_FILE outside the repository (e.g. under $env:TEMP).`
    );
  }

  console.log(`[LoadTest Tokens] Safety checks passed (localhost only).`);
  console.log(`[LoadTest Tokens] Target destination: ${resolvedPath}`);

  const client = await writerPool.connect();
  const tokens: string[] = [];

  try {
    const emailPattern = `${LOADTEST_EMAIL_PREFIX}%${LOADTEST_EMAIL_DOMAIN}`;

    // 3. Idempotency: Clean existing sessions for load-test users
    const delRes = await client.query(
      `DELETE FROM sessions WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE $1
       );`,
      [emailPattern]
    );
    console.log(`[LoadTest Tokens] Cleared ${delRes.rowCount || 0} existing load-test sessions.`);

    // 4. Retrieve all 500 load-test user IDs
    const usersRes = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM users
       WHERE email LIKE $1;`,
      [emailPattern]
    );

    if (usersRes.rows.length < LOADTEST_USER_COUNT) {
      throw new Error(
        `[FATAL] Expected at least ${LOADTEST_USER_COUNT} users in database, but found ${usersRes.rows.length}. Run scripts/loadtest-seed.ts first.`
      );
    }

    const userMap = new Map<string, string>();
    for (const row of usersRes.rows) {
      userMap.set(row.email.toLowerCase(), row.id);
    }

    // 5. Mint authenticated sessions using the app's createSession() helper
    // Index n-1 strictly corresponds to user n (loadtest+n@loadtest.invalid)
    console.log(`[LoadTest Tokens] Minting ${LOADTEST_USER_COUNT} sessions...`);
    for (let i = 1; i <= LOADTEST_USER_COUNT; i++) {
      const email = getLoadTestEmail(i);
      const userId = userMap.get(email);
      if (!userId) {
        throw new Error(`[FATAL] User ID not found for email: ${email}`);
      }

      const token = await createSession(userId);
      tokens.push(token);
    }

    // 6. Ensure destination directory exists and write tokens JSON
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, JSON.stringify(tokens, null, 2), 'utf-8');

    // 7. Output counts only - never print credentials or tokens (Rule 03)
    console.log(`[LoadTest Tokens] Successfully generated ${tokens.length} tokens to:`);
    console.log(`  -> ${resolvedPath}`);
  } finally {
    client.release();
    await writerPool.end();
  }
}

if (process.argv[1] && process.argv[1].includes('loadtest-tokens')) {
  mintTokens()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[LoadTest Tokens Error] ${err.message}`);
      process.exit(1);
    });
}

export { mintTokens };
