/**
 * A VUE Database Migration Runner (plain pg)
 * Rule 03: Forward-only numbered migrations ledger.
 * Uses DATABASE_DIRECT_URL for migrations.
 * Never resets or rolls back migrations.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { env } from '../env.js';

const { Client } = pg;

export async function runMigrations(): Promise<void> {
  const connectionString = env.DATABASE_DIRECT_URL || env.DATABASE_URL;

  // CommonJS-safe directory resolution (import.meta is not allowed in CommonJS output)
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  let migrationsDir = path.resolve(currentDir, '../../migrations');

  if (!fs.existsSync(migrationsDir)) {
    const distCandidate = path.resolve(currentDir, '../migrations');
    const cwdServerCandidate = path.resolve(process.cwd(), 'server/migrations');
    const cwdCandidate = path.resolve(process.cwd(), 'migrations');

    if (fs.existsSync(distCandidate)) {
      migrationsDir = distCandidate;
    } else if (fs.existsSync(cwdServerCandidate)) {
      migrationsDir = cwdServerCandidate;
    } else if (fs.existsSync(cwdCandidate)) {
      migrationsDir = cwdCandidate;
    }
  }

  // Must fail loudly (exit non-zero, clear message with folder NAME only) if folder is missing
  if (!fs.existsSync(migrationsDir)) {
    process.stderr.write("Migrations folder 'migrations' not found.\n");
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  // Must fail loudly (exit non-zero, clear message with folder NAME only) if folder has no .sql files
  if (files.length === 0) {
    process.stderr.write("Migrations folder 'migrations' has no .sql files.\n");
    process.exit(1);
  }

  process.stdout.write(`Found ${files.length} migration file(s) in 'migrations': ${files.join(', ')}\n`);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Ensure ledger table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_ledger (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch already applied migrations from ledger
    const ledgerResult = await client.query<{ filename: string; applied_at: Date }>(
      'SELECT filename, applied_at FROM migrations_ledger ORDER BY id ASC;',
    );
    const appliedFiles = new Set(ledgerResult.rows.map((r) => r.filename));

    if (appliedFiles.size > 0) {
      process.stdout.write(
        `Migrations already recorded in migrations_ledger (${appliedFiles.size}): ${Array.from(appliedFiles).join(', ')}\n`,
      );
    } else {
      process.stdout.write('migrations_ledger is empty (0 migrations previously recorded).\n');
    }

    let appliedCount = 0;

    for (const file of files) {
      if (!appliedFiles.has(file)) {
        process.stdout.write(`Applying migration: ${file}...\n`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO migrations_ledger (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING;',
            [file],
          );
          await client.query('COMMIT');
          appliedCount += 1;
          process.stdout.write(`Applied migration: ${file}\n`);
        } catch (err: any) {
          await client.query('ROLLBACK');
          process.stderr.write(`[FATAL] Migration failed on ${file}: ${err.message}\n`);
          throw err;
        }
      }
    }

    const totalApplied = appliedFiles.size + appliedCount;
    if (appliedCount === 0) {
      process.stdout.write(
        `Database is already up to date. 0 pending migrations. Total applied: ${totalApplied}.\n`,
      );
    } else {
      process.stdout.write(
        `Successfully applied ${appliedCount} migration(s). Total applied: ${totalApplied}.\n`,
      );
    }
  } finally {
    await client.end();
  }
}

// Allow direct execution from CLI
if (process.argv[1]?.includes('migrate.ts') || process.argv[1]?.includes('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
