import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  deleteAccountSchema,
  requestResetSchema,
  resetPasswordSchema,
  resendCodeSchema,
  restoreAccountSchema,
  signInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '../schemas/auth.js';
import { env } from '../env.js';
import { query, writerPool } from '../lib/db.js';
import { hashArgon2id, verifyArgon2id } from '../lib/argon2.js';
import {
  createSession,
  getSessionUser,
  parseToken,
  revokeAllUserSessions,
  revokeSession,
  rotateSession,
} from '../lib/session.js';
import { dispatchAuthCode, verifyAuthCode } from '../lib/code.js';
import { authRateLimit } from '../lib/rateLimit.js';
import { getRedisClient } from '../lib/redis.js';
import { sendAccountDeletionNoticeEmail, sendAccountExistsNoticeEmail } from '../lib/mailer.js';
import { releaseAllUserHolds } from '../lib/holds.js';
import { consumeEmailSendSlot } from '../lib/sendCap.js';

// Pre-computed dummy hash generated once at startup for constant-time dummy verification (Task 9)
let dummyArgon2Hash: string | null = null;

async function getDummyHash(): Promise<string> {
  if (!dummyArgon2Hash) {
    dummyArgon2Hash = await hashArgon2id('A-VUE-dummy-timing-password');
  }
  return dummyArgon2Hash;
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply rate limit on all auth routes
  fastify.addHook('preHandler', authRateLimit);

  // Initialize dummy hash on startup
  getDummyHash().catch(() => {});

  // 1. Sign Up (Task 9 Enumeration Safety, Task 2 Shared Send Cap, Task 3 Argon2id Timing)
  fastify.post('/auth/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = signUpSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    // Check if user already exists
    const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1;', [
      email,
    ]);

    if (existing.rows.length > 0) {
      // Existing user branch:
      // Task 3: Run Argon2id hash with same parameters as the real path (identical CPU timing)
      await hashArgon2id(data.password);

      // Task 2: Shared per-email send cap and cooldown
      const slot = await consumeEmailSendSlot(email);
      if (slot.allowed) {
        await sendAccountExistsNoticeEmail(email);
      }

      // Return IDENTICAL success response to prevent email enumeration (Task 9)
      return reply.status(200).send({
        message: 'Verification code sent to email',
        email,
        cooldownSeconds: 60,
      });
    }

    // New user branch:
    // Task 3: Hash password with Argon2id (same parameters) and cache pending registration (5 min TTL)
    const passwordHash = await hashArgon2id(data.password);
    try {
      const redis = getRedisClient();
      await redis.set(`pending_signup:${email}`, passwordHash, 'EX', 300);
    } catch {
      // Redis optional fallback
    }

    // Task 2: Shared per-email send cap and cooldown
    const slot = await consumeEmailSendSlot(email);
    if (slot.allowed) {
      await dispatchAuthCode(email, 'signup', true); // true = slot already consumed
    }

    return reply.status(200).send({
      message: 'Verification code sent to email',
      email,
      cooldownSeconds: 60,
    });
  });

  // 2. Verify Code (Completes account registration, creates session)
  fastify.post('/auth/verify-code', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = verifyCodeSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    // Verify 6-digit code (checks 5 attempts, expiry, Argon2id hash)
    await verifyAuthCode(email, data.code);

    // Retrieve cached password hash
    let passwordHash: string | null = null;
    try {
      const redis = getRedisClient();
      passwordHash = await redis.get(`pending_signup:${email}`);
      await redis.del(`pending_signup:${email}`);
    } catch {
      // Ignore
    }

    // Insert or activate user
    let userResult = await query<{ id: string; email: string; status: 'active' | 'locked' }>(
      `INSERT INTO users (email, password_hash, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (email) DO UPDATE SET status = 'active'
       RETURNING id, email, status;`,
      [email, passwordHash],
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new Error('Failed to create or activate user account.');
    }

    // Create session (public ID + 256-bit secret)
    const token = await createSession(user.id);

    return reply.status(200).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
      },
    });
  });

  // 3. Resend Code
  fastify.post('/auth/resend-code', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = resendCodeSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    const dispatchResult = await dispatchAuthCode(email, 'signup');

    return reply.status(200).send({
      message: 'Verification code resent successfully',
      cooldownSeconds: dispatchResult.cooldownSeconds,
    });
  });

  // 4. Sign In (Task 9: Constant-time verification against dummy hash for unknown emails)
  fastify.post('/auth/signin', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = signInSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    const result = await query<{
      id: string;
      email: string;
      password_hash: string | null;
      status: 'active' | 'locked';
      deleted_at: Date | string | null;
      purge_after: Date | string | null;
    }>('SELECT id, email, password_hash, status, deleted_at, purge_after FROM users WHERE email = $1;', [email]);

    const user = result.rows[0];

    // Constant-time execution for non-existent or inactive users
    if (!user || !user.password_hash || user.status !== 'active') {
      const dummy = await getDummyHash();
      await verifyArgon2id(dummy, data.password);
      return reply.status(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password. Please try again.',
          requestId: request.id,
        },
      });
    }

    const isMatch = await verifyArgon2id(user.password_hash, data.password);
    if (!isMatch) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password. Please try again.',
          requestId: request.id,
        },
      });
    }

    // Account scheduled for deletion: verified password required before exposing status (Task 4)
    if (user.deleted_at) {
      const purgeDate = user.purge_after ? new Date(user.purge_after) : null;
      if (purgeDate && purgeDate.getTime() <= Date.now()) {
        return reply.status(401).send({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password. Please try again.',
            requestId: request.id,
          },
        });
      }
      return reply.status(403).send({
        error: {
          code: 'ACCOUNT_SCHEDULED_FOR_DELETION',
          message: 'This account is scheduled for deletion.',
          purgeAfter: purgeDate ? purgeDate.toISOString() : new Date().toISOString(),
          requestId: request.id,
        },
      });
    }

    // Extract presented token if client provided one
    const authHeader = request.headers.authorization;
    const presentedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    // Session rotation
    const token = await rotateSession(user.id, presentedToken);

    return reply.status(200).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
      },
    });
  });

  // 5. Sign Out (Server-side session deletion)
  fastify.post('/auth/signout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      const parsed = parseToken(rawToken);
      if (parsed) {
        await revokeSession(parsed.publicId);
      }
    }

    return reply.status(200).send({
      message: 'Signed out successfully.',
    });
  });

  // 6. Reset Request (Email -> 6-digit code by email)
  fastify.post('/auth/reset-request', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = requestResetSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    const userCheck = await query<{ id: string }>('SELECT id FROM users WHERE email = $1;', [
      email,
    ]);

    if (userCheck.rows.length > 0) {
      const dispatchResult = await dispatchAuthCode(email, 'reset');
      return reply.status(200).send({
        message: 'Password reset code sent to email.',
        cooldownSeconds: dispatchResult.cooldownSeconds,
      });
    }

    // Return identical success response to prevent email enumeration
    return reply.status(200).send({
      message: 'Password reset code sent to email.',
      cooldownSeconds: 60,
    });
  });

  // 7. Reset Confirm (Code + New Password -> revokes all sessions)
  fastify.post('/auth/reset-confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = resetPasswordSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    // Verify 6-digit code
    await verifyAuthCode(email, data.code);

    // Hash new password with Argon2id
    const newHash = await hashArgon2id(data.newPassword);

    const updateRes = await query<{ id: string }>(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2 RETURNING id;',
      [newHash, email],
    );

    const user = updateRes.rows[0];
    if (user) {
      // Rule 02: Reset revokes all sessions
      await revokeAllUserSessions(user.id);
    }

    return reply.status(200).send({
      message: 'Password successfully reset. You may now sign in with your new password.',
    });
  });

  // 8. Protected Profile / Me Route (Demonstrates getSessionUser gate)
  fastify.get('/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getSessionUser(request);
    return reply.status(200).send({ user });
  });

  // 9. Account Delete (Task 4: Schedules account deletion with grace period)
  fastify.post('/auth/delete', async (request: FastifyRequest, reply: FastifyReply) => {
    let sessionUser;
    try {
      sessionUser = await getSessionUser(request);
    } catch {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to delete account.',
          requestId: request.id,
        },
      });
    }

    const data = deleteAccountSchema.parse(request.body);

    // Fetch user password_hash
    const userRes = await query<{ id: string; email: string; password_hash: string | null }>(
      'SELECT id, email, password_hash FROM users WHERE id = $1;',
      [sessionUser.id]
    );
    const user = userRes.rows[0];
    if (!user || !user.password_hash) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Incorrect password. Account deletion cancelled.',
          requestId: request.id,
        },
      });
    }

    const isMatch = await verifyArgon2id(user.password_hash, data.password);
    if (!isMatch) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Incorrect password. Account deletion cancelled.',
          requestId: request.id,
        },
      });
    }

    // Check for paid active tickets on upcoming showtimes
    const activeTicketsRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       JOIN showtimes s ON s.id = b.showtime_id
       WHERE t.user_id = $1
         AND t.status = 'active'
         AND s.starts_at > NOW();`,
      [user.id]
    );

    if (Number(activeTicketsRes.rows[0]?.count || 0) > 0) {
      return reply.status(409).send({
        error: {
          code: 'HAS_UPCOMING_TICKETS',
          message: 'Cannot delete account with upcoming tickets. Please wait until your showtime has passed or cancel your tickets.',
          requestId: request.id,
        },
      });
    }

    // ONE database transaction
    const pool = writerPool;
    const client = await pool.connect();
    const graceDays = env.DELETION_GRACE_DAYS;
    let purgeDateIso: string;

    try {
      await client.query('BEGIN');

      const updateRes = await client.query<{ purge_after: Date }>(
        `UPDATE users
         SET deleted_at = NOW(),
             purge_after = NOW() + ($1 || ' days')::INTERVAL,
             updated_at = NOW()
         WHERE id = $2
         RETURNING purge_after;`,
        [graceDays, user.id]
      );
      purgeDateIso = new Date(updateRes.rows[0].purge_after).toISOString();

      // Hard delete user sessions and auth codes
      await client.query('DELETE FROM sessions WHERE user_id = $1;', [user.id]);
      await client.query('DELETE FROM auth_codes WHERE email = $1;', [user.email]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Revoke cached sessions and release seat holds
    await revokeAllUserSessions(user.id);
    await releaseAllUserHolds(user.id);

    // Send confirmation email
    const formattedPurgeDate = new Date(purgeDateIso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    await sendAccountDeletionNoticeEmail(user.email, formattedPurgeDate);

    return reply.status(200).send({
      message: 'Account scheduled for deletion.',
      purgeAfter: purgeDateIso,
    });
  });

  // 10. Account Restore (Task 4: Cancels scheduled deletion and restores account)
  fastify.post('/auth/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = restoreAccountSchema.parse(request.body);
    const email = data.email.toLowerCase().trim();

    const result = await query<{
      id: string;
      email: string;
      password_hash: string | null;
      status: 'active' | 'locked';
      deleted_at: Date | string | null;
      purge_after: Date | string | null;
    }>(
      'SELECT id, email, password_hash, status, deleted_at, purge_after FROM users WHERE email = $1;',
      [email]
    );

    const user = result.rows[0];

    // Check existence, deletion status, and expiry of grace period
    if (
      !user ||
      !user.password_hash ||
      !user.deleted_at ||
      (user.purge_after && new Date(user.purge_after).getTime() <= Date.now())
    ) {
      const dummy = await getDummyHash();
      await verifyArgon2id(dummy, data.password);
      return reply.status(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password. Please try again.',
          requestId: request.id,
        },
      });
    }

    const isMatch = await verifyArgon2id(user.password_hash, data.password);
    if (!isMatch) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password. Please try again.',
          requestId: request.id,
        },
      });
    }

    // Clear deletion timestamps and restore
    await query(
      `UPDATE users
       SET deleted_at = NULL,
           purge_after = NULL,
           status = 'active',
           updated_at = NOW()
       WHERE id = $1;`,
      [user.id]
    );

    const token = await createSession(user.id);

    return reply.status(200).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        status: 'active',
      },
    });
  });
}
