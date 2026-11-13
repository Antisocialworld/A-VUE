/**
 * A VUE Load-Test Session Token Generator
 * Generates 500 test user accounts on domain @example.invalid,
 * creates authenticated sessions, and writes the tokens to a git-ignored local file.
 * Strictly refuses to run when NODE_ENV is production.
 * Never prints tokens or credentials to stdout.
 * (Rule 02 / Rule 04 / Task 6b)
 */

import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/env.js';
import { hashArgon2id } from '../src/lib/argon2.js';
import { writerPool } from '../src/lib/db.js';
import { createSession } from '../src/lib/session.js';

async function generateSessions() {
  if (env.NODE_ENV === 'production') {
    throw new Error('[FATAL] Refusing to generate load-test sessions in production environment.');
  }

  const userCount = 500;
  const tokens: string[] = [];
  const dummyPasswordHash = await hashArgon2id('LoadTestP@ss123');

  console.log(`[LoadTest Setup] Provisioning ${userCount} test user sessions...`);

  const client = await writerPool.connect();
  try {
    for (let i = 1; i <= userCount; i++) {
      const email = `vu_${i}@example.invalid`;

      // Upsert user
      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (email) DO UPDATE SET status = 'active'
         RETURNING id`,
        [email, dummyPasswordHash]
      );

      const userId = userRes.rows[0].id;
      const token = await createSession(userId);
      tokens.push(token);
    }

    // Write to git-ignored local files
    const outputPathServer = path.resolve(process.cwd(), '.loadtest-tokens.json');
    const outputPathRoot = path.resolve(process.cwd(), '../load-tests/tokens.json');

    fs.writeFileSync(outputPathServer, JSON.stringify(tokens, null, 2), 'utf-8');
    try {
      const loadTestsDir = path.resolve(process.cwd(), '../load-tests');
      if (fs.existsSync(loadTestsDir)) {
        fs.writeFileSync(outputPathRoot, JSON.stringify(tokens, null, 2), 'utf-8');
      }
    } catch {
      // Non-fatal if root load-tests folder is accessed differently
    }

    // Never print tokens or passwords (Rule 03)
    console.log(`[LoadTest Setup] Successfully generated ${tokens.length} tokens to .loadtest-tokens.json and load-tests/tokens.json`);
  } finally {
    client.release();
    await writerPool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('loadtest-sessions.ts')) {
  generateSessions().catch((err) => {
    console.error('[LoadTest Error]', err.message);
    process.exit(1);
  });
}

export { generateSessions };

