import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Server Account Deletion & Grace Period Lifecycle (Task 4)', () => {
  const migration005Path = path.resolve(__dirname, '../../migrations/005_users_deletion_grace.sql');
  const envPath = path.resolve(__dirname, '../env.ts');
  const authRoutePath = path.resolve(__dirname, '../routes/auth.ts');
  const cronRoutePath = path.resolve(__dirname, '../routes/cron.ts');
  const holdsLibPath = path.resolve(__dirname, '../lib/holds.ts');
  const mailerLibPath = path.resolve(__dirname, '../lib/mailer.ts');

  const migrationSrc = fs.readFileSync(migration005Path, 'utf-8');
  const envSrc = fs.readFileSync(envPath, 'utf-8');
  const authRouteSrc = fs.readFileSync(authRoutePath, 'utf-8');
  const cronRouteSrc = fs.readFileSync(cronRoutePath, 'utf-8');
  const holdsLibSrc = fs.readFileSync(holdsLibPath, 'utf-8');
  const mailerLibSrc = fs.readFileSync(mailerLibPath, 'utf-8');

  it('migration 005 safely adds deleted_at, purge_after, and partial index', () => {
    expect(migrationSrc).toContain('ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    expect(migrationSrc).toContain('ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ');
    expect(migrationSrc).toContain('CREATE INDEX IF NOT EXISTS idx_users_purge_after ON users(purge_after)');
    expect(migrationSrc).toContain('WHERE deleted_at IS NOT NULL');
  });

  it('env schema defines DELETION_GRACE_DAYS with default 30, min 1, max 90', () => {
    expect(envSrc).toContain('DELETION_GRACE_DAYS');
    expect(envSrc).toContain('.default(30)');
  });

  it('holds library provides releaseAllUserHolds for redis hold cleanup', () => {
    expect(holdsLibSrc).toContain('export async function releaseAllUserHolds(userId: string)');
    expect(holdsLibSrc).toContain('RELEASE_SEATS_LUA');
    expect(holdsLibSrc).toContain("keys('hold:*')");
  });

  it('mailer provides sendAccountDeletionNoticeEmail with purge date and restore info', () => {
    expect(mailerLibSrc).toContain('export async function sendAccountDeletionNoticeEmail');
    expect(mailerLibSrc).toContain('A VUE — Account Scheduled for Deletion');
  });

  it('POST /auth/delete guards against upcoming tickets and sets grace window in transaction', () => {
    expect(authRouteSrc).toContain("fastify.post('/auth/delete'");
    expect(authRouteSrc).toContain('getSessionUser(');
    expect(authRouteSrc).toContain('deleteAccountSchema.parse');
    expect(authRouteSrc).toContain('verifyArgon2id(');
    // Upcoming tickets check
    expect(authRouteSrc).toContain('starts_at > NOW()');
    expect(authRouteSrc).toContain('HAS_UPCOMING_TICKETS');
    // Transactional deletion
    expect(authRouteSrc).toContain('BEGIN');
    expect(authRouteSrc).toContain('deleted_at = NOW()');
    expect(authRouteSrc).toContain('purge_after = NOW() + ($1 || \' days\')::INTERVAL');
    expect(authRouteSrc).toContain('DELETE FROM sessions WHERE user_id = $1');
    expect(authRouteSrc).toContain('DELETE FROM auth_codes WHERE email = $1');
    expect(authRouteSrc).toContain('COMMIT');
    // Cleans up Redis holds and revokes in-memory session cache
    expect(authRouteSrc).toContain('releaseAllUserHolds(');
    expect(authRouteSrc).toContain('revokeAllUserSessions(');
  });

  it('never deletes financial, booking, ticket, or ledger rows on delete', () => {
    expect(authRouteSrc).not.toMatch(/DELETE\s+FROM\s+bookings/i);
    expect(authRouteSrc).not.toMatch(/DELETE\s+FROM\s+payments/i);
    expect(authRouteSrc).not.toMatch(/DELETE\s+FROM\s+tickets/i);
    expect(authRouteSrc).not.toMatch(/DELETE\s+FROM\s+ledger/i);
  });

  it('POST /auth/signin returns 403 ACCOUNT_SCHEDULED_FOR_DELETION for scheduled users', () => {
    expect(authRouteSrc).toContain('ACCOUNT_SCHEDULED_FOR_DELETION');
    expect(authRouteSrc).toContain('user.deleted_at');
    expect(authRouteSrc).toContain('purgeAfter');
  });

  it('POST /auth/restore clears deleted_at and returns new session', () => {
    expect(authRouteSrc).toContain("fastify.post('/auth/restore'");
    expect(authRouteSrc).toContain('deleted_at = NULL');
    expect(authRouteSrc).toContain('purge_after = NULL');
    expect(authRouteSrc).toContain('createSession(');
  });

  it('POST /cron/purge-users checks CRON_SECRET with constant-time equality and anonymises in place', () => {
    expect(cronRouteSrc).toContain("fastify.post('/cron/purge-users'");
    expect(cronRouteSrc).toContain('crypto.timingSafeEqual');
    expect(cronRouteSrc).toContain('purge_after < NOW()');
    expect(cronRouteSrc).toContain("email = 'anon_' || gen_random_uuid() || '@deleted.invalid'");
    expect(cronRouteSrc).toContain("password_hash = '!deleted_' || gen_random_uuid()");
    expect(cronRouteSrc).toContain("status = 'locked'");
    expect(cronRouteSrc).not.toMatch(/DELETE\s+FROM\s+users/i);
  });

  it('zero Math.random used across auth and cron implementations', () => {
    expect(authRouteSrc).not.toContain('Math.random');
    expect(cronRouteSrc).not.toContain('Math.random');
  });
});
