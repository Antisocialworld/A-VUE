/**
 * A VUE Load-Test Shared Configuration & Safety Guards
 * Rule 02 (Security), Rule 04 (Traffic)
 *
 * Guarantees:
 * - Refuses to execute in production environment.
 * - Refuses to execute unless DATABASE_URL and REDIS_URL hosts are localhost or 127.0.0.1.
 * - Never hardcodes, logs, or prints secrets, tokens, or passwords.
 * - Shared configuration and email format for seed, cleanup, and verification.
 */

import { env } from '../src/env.js';

export const LOADTEST_USER_COUNT = 500;
export const LOADTEST_EMAIL_PREFIX = 'loadtest+';
export const LOADTEST_EMAIL_DOMAIN = '@loadtest.invalid';

/**
 * Returns formatted email for VU number n (1-indexed).
 */
export function getLoadTestEmail(n: number): string {
  return `${LOADTEST_EMAIL_PREFIX}${n}${LOADTEST_EMAIL_DOMAIN}`;
}

/**
 * Extracts hostname from standard URL or connection string.
 */
export function extractHost(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return (parsed.hostname || '').toLowerCase();
  } catch {
    const match = urlStr.match(/@([^:/]+)/) || urlStr.match(/:\/\/([^:/]+)/);
    return match ? match[1].toLowerCase() : '';
  }
}

/**
 * Validates whether the given connection string targets localhost.
 */
export function isLocalhost(urlStr: string): boolean {
  const host = extractHost(urlStr);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Asserts that the current execution environment is strictly local.
 * Throws fatal error without printing connection strings or secrets.
 */
export function assertLocalhostEnvironment(): void {
  if (env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('[FATAL] Refusing to run load test script in production environment.');
  }

  const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL || env.REDIS_URL;

  if (!isLocalhost(dbUrl)) {
    throw new Error('[FATAL] Refusing to run: DATABASE_URL host is not localhost or 127.0.0.1.');
  }

  if (!isLocalhost(redisUrl)) {
    throw new Error('[FATAL] Refusing to run: REDIS_URL host is not localhost or 127.0.0.1.');
  }
}

/**
 * Retrieves LOADTEST_PASSWORD from environment at runtime.
 * Refuses to continue if missing. Never logs or prints the password.
 */
export function getLoadTestPassword(): string {
  const pwd = process.env.LOADTEST_PASSWORD;
  if (!pwd || pwd.trim().length === 0) {
    throw new Error(
      '[FATAL] LOADTEST_PASSWORD environment variable is required at runtime. Set LOADTEST_PASSWORD before running.'
    );
  }
  return pwd;
}
