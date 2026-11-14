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

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: 'active' | 'locked';
}

interface CachedSession {
  userId: string;
  userEmail: string;
  userStatus: 'active' | 'locked';
  secretHash: string;
  cachedAt: number;
  lastActiveAt: number;
  expiresAt: number;
}

// 60-second in-memory verified secret cache (Rule 02, Design B3)
const verifiedSessionCache = new Map<string, CachedSession>();

const IDLE_TIMEOUT_MS = env.SESSION_IDLE_TTL_DAYS * 24 * 60 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = env.SESSION_CACHE_TTL_SECONDS * 1000;

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
      cachedAt: now,
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
 * Revokes a single session (sign out).
 */
export async function revokeSession(publicId: string): Promise<void> {
  verifiedSessionCache.delete(publicId);
  await query('DELETE FROM sessions WHERE id = $1;', [publicId]);
}

/**
 * Revokes all sessions for a user (password change, reset, account delete).
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  for (const [key, val] of verifiedSessionCache.entries()) {
    if (val.userId === userId) {
      verifiedSessionCache.delete(key);
    }
  }
  await query('DELETE FROM sessions WHERE user_id = $1;', [userId]);
}

/**
 * One gate function getSessionUser() on every protected route.
 * Checks expiry, idle timeout, and user active status.
 * Bad session -> generic failure and row deleted.
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

  // 1. Check in-memory 60s cache
  const cached = verifiedSessionCache.get(publicId);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    // Check timeouts
    if (now > cached.expiresAt || now - cached.lastActiveAt > IDLE_TIMEOUT_MS) {
      await revokeSession(publicId);
      throw new UnauthorizedError('Unauthorized');
    }
    if (cached.userStatus !== 'active') {
      await revokeSession(publicId);
      throw new UnauthorizedError('Unauthorized');
    }
    // Update last active
    cached.lastActiveAt = now;
    return {
      id: cached.userId,
      email: cached.userEmail,
      status: cached.userStatus,
    };
  }

  // 2. Query database for session & user
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

  // 3. Verify absolute expiry and idle expiry
  const expiresAtMs = new Date(row.expires_at).getTime();
  const lastActiveMs = new Date(row.last_active_at).getTime();

  if (now > expiresAtMs || now - lastActiveMs > IDLE_TIMEOUT_MS || row.status !== 'active') {
    await revokeSession(publicId);
    throw new UnauthorizedError('Unauthorized');
  }

  // 4. Verify secret hash with Argon2id
  const isSecretValid = await verifyArgon2id(row.secret_hash, secret);
  if (!isSecretValid) {
    await revokeSession(publicId);
    throw new UnauthorizedError('Unauthorized');
  }

  // 5. Update last_active_at in DB
  await query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1;', [publicId]);

  // 6. Cache verified secret for 60 seconds
  verifiedSessionCache.set(publicId, {
    userId: row.user_id,
    userEmail: row.email,
    userStatus: row.status,
    secretHash: row.secret_hash,
    cachedAt: now,
    lastActiveAt: now,
    expiresAt: expiresAtMs,
  });

  return {
    id: row.user_id,
    email: row.email,
    status: row.status,
  };
}

