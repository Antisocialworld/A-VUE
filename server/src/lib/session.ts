import crypto from 'node:crypto';
import { FastifyRequest } from 'fastify';
import { query } from './db.js';
import { hashArgon2id, verifyArgon2id } from './argon2.js';
import { env } from '../env.js';

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ServerBusyError extends Error {
  readonly statusCode: number = 503;
  readonly code: string = 'SERVER_BUSY';
  readonly retryAfter: number = 2;
  readonly headers: Record<string, string> = {
    'Retry-After': '2',
  };

  constructor(message = 'Server is busy. Please try again.') {
    super(message);
    this.name = 'ServerBusyError';
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: 'active' | 'locked';
}

export interface CachedSession {
  userId: string;
  userEmail: string;
  userStatus: 'active' | 'locked';
  secretHash: string;
  secret: string;
  verifiedAt: number;     // Timestamp of last full Argon2 verify (for hard cap)
  lastAccessedAt: number; // Timestamp of last cache hit (renewed on hit)
  lastActiveAt: number;   // Timestamp of last activity (for DB idle timeout)
  expiresAt: number;      // Absolute expiry timestamp
}

// Sliding in-memory cache with hard cap (Rule 02, Design B3, Task 2)
const verifiedSessionCache = new Map<string, CachedSession>();

export interface InFlightVerify {
  secret: string;
  promise: Promise<AuthenticatedUser>;
}

// In-flight Promise deduplication map: keyed by publicId (never log the key or secret)
const inFlightVerifies = new Map<string, InFlightVerify>();

/**
 * Compares two secrets in constant time using crypto.timingSafeEqual (Task A).
 * Returns false if buffer lengths differ.
 */
function constantTimeSecretCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const IDLE_TIMEOUT_MS = env.SESSION_IDLE_TTL_DAYS * 24 * 60 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 * 1000;
const CACHE_IDLE_MS = env.SESSION_CACHE_IDLE_SECONDS * 1000;
const CACHE_MAX_MS = env.SESSION_CACHE_MAX_SECONDS * 1000;

let activeSessionVerifies = 0;

/**
 * Bounded concurrency slot acquisition for Argon2 session verify (Task 2d).
 * Replaces unbounded wait with SESSION_VERIFY_MAX_WAIT_MS.
 * Yields every 10ms so it never spins without yielding.
 */
export async function acquireConcurrencySlot(): Promise<void> {
  const start = Date.now();
  const maxWait = env.SESSION_VERIFY_MAX_WAIT_MS;

  while (activeSessionVerifies >= env.ARGON2_MAX_CONCURRENCY) {
    if (Date.now() - start >= maxWait) {
      throw new ServerBusyError('Server is busy. Please try again.');
    }
    // Yield to the event loop so we never spin without yielding
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  activeSessionVerifies += 1;
}

export function releaseConcurrencySlot(): void {
  activeSessionVerifies = Math.max(0, activeSessionVerifies - 1);
}

export function parseToken(rawToken: string): { publicId: string; secret: string } | null {
  const parts = rawToken.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { publicId: parts[0], secret: parts[1] };
}

/**
 * Creates a new session: public ID + 256-bit secret from crypto.randomBytes.
 * DB stores Argon2id hash of the secret.
 */
export async function createSession(userId: string): Promise<string> {
  const publicId = crypto.randomBytes(16).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex'); // 256 bits of entropy

  const secretHash = await hashArgon2id(secret);
  const now = Date.now();
  const expiresAt = new Date(now + ABSOLUTE_TIMEOUT_MS);

  await query(
    `INSERT INTO sessions (id, user_id, secret_hash, last_active_at, expires_at)
     VALUES ($1, $2, $3, NOW(), $4);`,
    [publicId, userId, secretHash, expiresAt.toISOString()],
  );

  // Fetch user email for cache
  const userRes = await query<{ email: string; status: 'active' | 'locked' }>(
    `SELECT email, status FROM users WHERE id = $1;`,
    [userId],
  );

  const user = userRes.rows[0];
  if (user) {
    verifiedSessionCache.set(publicId, {
      userId,
      userEmail: user.email,
      userStatus: user.status,
      secretHash,
      secret,
      verifiedAt: now,
      lastAccessedAt: now,
      lastActiveAt: now,
      expiresAt: expiresAt.getTime(),
    });
  }

  return `${publicId}.${secret}`;
}

/**
 * Rotates session on login:
 * Deletes only the session this device presented (other devices stay signed in).
 */
export async function rotateSession(
  userId: string,
  presentedToken?: string,
): Promise<string> {
  if (presentedToken) {
    const parsed = parseToken(presentedToken);
    if (parsed) {
      await revokeSession(parsed.publicId);
    }
  }
  return createSession(userId);
}

/**
 * Revokes a single session (sign out, deletion, invalidation).
 * Evicts from both verifiedSessionCache and inFlightVerifies (Task 2b).
 */
export async function revokeSession(publicId: string): Promise<void> {
  verifiedSessionCache.delete(publicId);
  inFlightVerifies.delete(publicId);
  await query('DELETE FROM sessions WHERE id = $1;', [publicId]);
}

/**
 * Revokes all sessions for a user (password change, reset, account delete).
 * Evicts all matching sessions from verifiedSessionCache and inFlightVerifies (Task 2b).
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  for (const [key, val] of verifiedSessionCache.entries()) {
    if (val.userId === userId) {
      verifiedSessionCache.delete(key);
      inFlightVerifies.delete(key);
    }
  }
  await query('DELETE FROM sessions WHERE user_id = $1;', [userId]);
}

/**
 * Executes a full database query and Argon2 verify on cache miss or hard cap expiry.
 */
async function performFullSessionVerify(
  request: FastifyRequest,
  publicId: string,
  secret: string,
): Promise<AuthenticatedUser> {
  const now = Date.now();

  // Query database for session & user
  const result = await query<{
    user_id: string;
    secret_hash: string;
    last_active_at: Date;
    expires_at: Date;
    email: string;
    status: 'active' | 'locked';
  }>(
    `SELECT s.user_id, s.secret_hash, s.last_active_at, s.expires_at, u.email, u.status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1;`,
    [publicId],
  );

  const row = result.rows[0];
  if (!row) {
    verifiedSessionCache.delete(publicId);
    throw new UnauthorizedError('Unauthorized');
  }

  // Verify absolute expiry, idle expiry and active status
  const expiresAtMs = new Date(row.expires_at).getTime();
  const lastActiveMs = new Date(row.last_active_at).getTime();

  if (now > expiresAtMs || now - lastActiveMs > IDLE_TIMEOUT_MS || row.status !== 'active') {
    await revokeSession(publicId);
    throw new UnauthorizedError('Unauthorized');
  }

  // Bounded wait concurrency slot for Argon2 verify (Task 2d)
  try {
    await acquireConcurrencySlot();
    try {
      const isSecretValid = await verifyArgon2id(row.secret_hash, secret);
      if (!isSecretValid) {
        throw new UnauthorizedError('Unauthorized');
      }
    } finally {
      releaseConcurrencySlot();
    }
  } catch (err: any) {
    if (err instanceof ServerBusyError) {
      // Attach Retry-After header on response if raw response is accessible
      const rawRes = (request as any)?.raw?.res || (request as any)?.res;
      if (rawRes && typeof rawRes.setHeader === 'function') {
        try {
          rawRes.setHeader('Retry-After', String(err.retryAfter));
        } catch {}
      }
      throw err;
    }
    throw err;
  }

  // Update last_active_at in DB
  await query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1;', [publicId]);

  // Cache verified session with sliding window and hard cap timestamps (Task 2a & Task D)
  verifiedSessionCache.set(publicId, {
    userId: row.user_id,
    userEmail: row.email,
    userStatus: row.status,
    secretHash: row.secret_hash,
    secret,
    verifiedAt: now,
    lastAccessedAt: now,
    lastActiveAt: now,
    expiresAt: expiresAtMs,
  });

  return {
    id: row.user_id,
    email: row.email,
    status: row.status,
  };
}

/**
 * One gate function getSessionUser() on every protected route.
 * Checks sliding cache, deduplicates concurrent verifies, and enforces bounded wait.
 */
export async function getSessionUser(request: FastifyRequest): Promise<AuthenticatedUser> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Unauthorized');
  }

  const rawToken = authHeader.slice(7).trim();
  const parsed = parseToken(rawToken);
  if (!parsed) {
    throw new UnauthorizedError('Unauthorized');
  }

  const { publicId, secret } = parsed;
  const now = Date.now();

  // 1. Check in-memory sliding cache with hard cap (Task 2a & Task D)
  const cached = verifiedSessionCache.get(publicId);
  if (
    cached &&
    now - cached.lastAccessedAt < CACHE_IDLE_MS &&
    now - cached.verifiedAt < CACHE_MAX_MS
  ) {
    // Task D: Verify secret on every cache hit before any other hit logic
    if (!constantTimeSecretCompare(cached.secret, secret)) {
      throw new UnauthorizedError('Unauthorized');
    }

    // Check timeouts
    if (now > cached.expiresAt || now - cached.lastActiveAt > IDLE_TIMEOUT_MS) {
      await revokeSession(publicId);
      throw new UnauthorizedError('Unauthorized');
    }
    if (cached.userStatus !== 'active') {
      await revokeSession(publicId);
      throw new UnauthorizedError('Unauthorized');
    }

    // Sliding renewal: renew idle window and last active on hit
    cached.lastAccessedAt = now;
    cached.lastActiveAt = now;

    return {
      id: cached.userId,
      email: cached.userEmail,
      status: cached.userStatus,
    };
  }

  // 2. Dedupe concurrent verifies for the same session (Task 2c & Task A)
  const existingInFlight = inFlightVerifies.get(publicId);
  if (existingInFlight) {
    if (constantTimeSecretCompare(existingInFlight.secret, secret)) {
      return await existingInFlight.promise;
    }
    // Secret does not match: do NOT join and do NOT register in inFlightVerifies (Task A).
    // Run full verify independently (which will query DB, verify with Argon2, fail and throw).
    return await performFullSessionVerify(request, publicId, secret);
  }

  const inFlightEntry = {
    secret,
  } as InFlightVerify;

  inFlightEntry.promise = (async () => {
    try {
      return await performFullSessionVerify(request, publicId, secret);
    } finally {
      // Delete the map entry only if the map's current entry is that same object (Task F.a)
      if (inFlightVerifies.get(publicId) === inFlightEntry) {
        inFlightVerifies.delete(publicId);
      }
    }
  })();

  inFlightVerifies.set(publicId, inFlightEntry);
  return await inFlightEntry.promise;
}

/**
 * Inspection and reset helpers for unit tests.
 */
export function _getVerifiedSessionCache(): Map<string, CachedSession> {
  return verifiedSessionCache;
}

export function _getInFlightVerifies(): Map<string, InFlightVerify> {
  return inFlightVerifies;
}

export function _getActiveSessionVerifies(): number {
  return activeSessionVerifies;
}

export function _resetSessionCache(): void {
  verifiedSessionCache.clear();
  inFlightVerifies.clear();
  activeSessionVerifies = 0;
}
