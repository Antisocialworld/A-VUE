/**
 * UNVERIFIED PLATFORM ITEM: Native Argon2 binary on Vercel Serverless (Hobby).
 * Rule 02: Argon2id, own random salt per hash, capped by ARGON2_MAX_CONCURRENCY.
 * Status: Unverified on Vercel until Phase 0 deployment proof.
 * This module is isolated so it can be swapped for a WebAssembly/pure-JS fallback
 * if native libuv compilation fails on AWS Lambda / Vercel.
 */

import * as argon2 from 'argon2';
import { env } from '../env.js';

let activeArgon2Jobs = 0;

async function acquireConcurrencySlot(): Promise<void> {
  while (activeArgon2Jobs >= env.ARGON2_MAX_CONCURRENCY) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  activeArgon2Jobs += 1;
}

function releaseConcurrencySlot(): void {
  activeArgon2Jobs = Math.max(0, activeArgon2Jobs - 1);
}

export async function hashArgon2id(plain: string): Promise<string> {
  await acquireConcurrencySlot();
  try {
    return await argon2.hash(plain, {
      type: argon2.argon2id,
      timeCost: env.ARGON2_TIME_COST,
      memoryCost: env.ARGON2_MEMORY_COST,
    });
  } finally {
    releaseConcurrencySlot();
  }
}

export async function verifyArgon2id(hash: string, plain: string): Promise<boolean> {
  await acquireConcurrencySlot();
  try {
    return await argon2.verify(hash, plain);
  } finally {
    releaseConcurrencySlot();
  }
}

