/**
 * A VUE Argon2id Timing Benchmark Script
 * Measures sequential and concurrent verify throughput to determine
 * whether the 10s connectionTimeout under 500 VUs is caused by
 * queueing behind Argon2 verification.
 *
 * Rules:
 * - Rule 02 (Security): No secrets/passwords/hashes printed, logged, or stored.
 * - Touches NO database and NO Redis.
 * - Uses existing Argon2id helpers and production parameters from env.
 *
 * Usage (Run from server/ folder):
 *   npx tsx scripts/loadtest-argon2-timing.ts
 */

import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as argon2 from 'argon2';
import { env } from '../src/env.js';
import { hashArgon2id, verifyArgon2id } from '../src/lib/argon2.js';

/**
 * Runs a fixed number of operations across a pool of concurrent workers
 * using plain Promise batching (without the app's concurrency slot limiter).
 */
async function runConcurrentVerifies(
  total: number,
  concurrency: number,
  fn: () => Promise<boolean>
): Promise<{ totalTimeMs: number; opsPerSec: number }> {
  let executed = 0;
  const start = performance.now();

  async function worker(): Promise<void> {
    while (true) {
      if (executed >= total) {
        break;
      }
      executed++;
      await fn();
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalTimeMs = performance.now() - start;
  const opsPerSec = total / (totalTimeMs / 1000);
  return { totalTimeMs, opsPerSec };
}

async function runBenchmark(): Promise<void> {
  // Generate a random throwaway value in memory and hash it once (never print or log)
  const throwawaySecret = crypto.randomBytes(32).toString('hex');
  const throwawayHash = await hashArgon2id(throwawaySecret);

  // Print Argon2 parameters in use
  console.log('Argon2 Parameters:');
  console.log(`  memory:                 ${env.ARGON2_MEMORY_COST} KiB`);
  console.log(`  iterations (timeCost):  ${env.ARGON2_TIME_COST}`);
  console.log(`  parallelism:            1`);
  console.log(`  ARGON2_MAX_CONCURRENCY: ${env.ARGON2_MAX_CONCURRENCY}`);
  console.log('');

  // 1. 20 sequential verifies
  const sequentialDurations: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await verifyArgon2id(throwawayHash, throwawaySecret);
    const duration = performance.now() - start;
    sequentialDurations.push(duration);
  }

  sequentialDurations.sort((a, b) => a - b);
  const min = sequentialDurations[0];
  const max = sequentialDurations[sequentialDurations.length - 1];
  const mid = Math.floor(sequentialDurations.length / 2);
  const median =
    sequentialDurations.length % 2 === 0
      ? (sequentialDurations[mid - 1] + sequentialDurations[mid]) / 2
      : sequentialDurations[mid];
  const p95Index = Math.min(
    sequentialDurations.length - 1,
    Math.max(0, Math.ceil(0.95 * sequentialDurations.length) - 1)
  );
  const p95 = sequentialDurations[p95Index];

  console.log('Sequential (20 verifies):');
  console.log(`  min:                    ${min.toFixed(2)} ms`);
  console.log(`  median:                 ${median.toFixed(2)} ms`);
  console.log(`  p95:                    ${p95.toFixed(2)} ms`);
  console.log(`  max:                    ${max.toFixed(2)} ms`);
  console.log('');

  // 2. 100 verifies at concurrency 4 (plain Promise batching / worker queue, NOT slot limiter)
  const c4 = await runConcurrentVerifies(100, 4, () =>
    argon2.verify(throwawayHash, throwawaySecret)
  );
  console.log('Concurrency 4 (100 verifies):');
  console.log(`  total time:             ${c4.totalTimeMs.toFixed(2)} ms`);
  console.log(`  verifies-per-second:    ${c4.opsPerSec.toFixed(2)}`);
  console.log('');

  // 3. 100 verifies at concurrency 8 (plain Promise batching / worker queue, NOT slot limiter)
  const c8 = await runConcurrentVerifies(100, 8, () =>
    argon2.verify(throwawayHash, throwawaySecret)
  );
  console.log('Concurrency 8 (100 verifies):');
  console.log(`  total time:             ${c8.totalTimeMs.toFixed(2)} ms`);
  console.log(`  verifies-per-second:    ${c8.opsPerSec.toFixed(2)}`);
}

runBenchmark().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[FATAL] Benchmark execution failed:', message);
  process.exit(1);
});
