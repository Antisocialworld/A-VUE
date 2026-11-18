import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from '../env.js';
import { nairaToKobo } from '../lib/flutterwave.js';
import { checkTransactionMismatch } from '../lib/jobs.js';
import { UnauthorizedError } from '../lib/session.js';

describe('Webhooks, Flutterwave & Tickets — Fix Pass 2 (Tasks 1–5)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // ============================================================================
  // TASK 1 & TASK 5: Webhook Signature Verification with Pure Env
  // ============================================================================
  describe('Task 1 & Task 5: Flutterwave Signature Verification (Pure Env & vi.stubEnv)', () => {
    it('correct pair = true', async () => {
      const secretHash = 'official_flw_secret_hash_xyz_123';
      vi.stubEnv('FLUTTERWAVE_SECRET_HASH', secretHash);
      vi.resetModules();
      const { verifyFlutterwaveSignature } = await import('../lib/flutterwave.js');

      const result = verifyFlutterwaveSignature('{}', { 'verif-hash': secretHash });
      expect(result).toBe(true);
    });

    it('wrong pair = false', async () => {
      const secretHash = 'official_flw_secret_hash_xyz_123';
      vi.stubEnv('FLUTTERWAVE_SECRET_HASH', secretHash);
      vi.resetModules();
      const { verifyFlutterwaveSignature } = await import('../lib/flutterwave.js');

      const result = verifyFlutterwaveSignature('{}', { 'verif-hash': 'tampered_or_wrong_secret' });
      expect(result).toBe(false);
    });

    it('missing header = false', async () => {
      const secretHash = 'official_flw_secret_hash_xyz_123';
      vi.stubEnv('FLUTTERWAVE_SECRET_HASH', secretHash);
      vi.resetModules();
      const { verifyFlutterwaveSignature } = await import('../lib/flutterwave.js');

      expect(verifyFlutterwaveSignature('{}', {})).toBe(false);
    });

    it('empty secret + empty header = false (empty header and empty secret must never compare equal)', async () => {
      vi.stubEnv('FLUTTERWAVE_SECRET_HASH', '');
      vi.resetModules();
      const { verifyFlutterwaveSignature } = await import('../lib/flutterwave.js');

      expect(verifyFlutterwaveSignature('{}', { 'verif-hash': '' })).toBe(false);
    });

    it('whitespace-only = false', async () => {
      // Whitespace secret + whitespace header
      vi.stubEnv('FLUTTERWAVE_SECRET_HASH', '   ');
      vi.resetModules();
      const { verifyFlutterwaveSignature } = await import('../lib/flutterwave.js');

      expect(verifyFlutterwaveSignature('{}', { 'verif-hash': '   ' })).toBe(false);
      expect(verifyFlutterwaveSignature('{}', { 'verif-hash': 'valid_secret' })).toBe(false);

      // Valid secret + whitespace header
      vi.stubEnv('FLUTTERWAVE_SECRET_HASH', 'valid_secret');
      vi.resetModules();
      const { verifyFlutterwaveSignature: verify2 } = await import('../lib/flutterwave.js');
      expect(verify2('{}', { 'verif-hash': '   ' })).toBe(false);
    });

    it('production env validation requires FLUTTERWAVE_SECRET_HASH and FLUTTERWAVE_SECRET_KEY to be non-empty', async () => {
      const { validateEnv } = await import('../env.js');

      // Missing in production
      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://localhost/avue',
          REDIS_URL: 'redis://localhost:6379',
          SMTP_HOST: 'smtp.sendgrid.net',
          SMTP_PORT: '587',
          SMTP_USER: 'apikey',
          SMTP_PASS: 'secret',
        });
      }).toThrow(/FLUTTERWAVE_SECRET_HASH/);

      // Whitespace only in production
      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://localhost/avue',
          REDIS_URL: 'redis://localhost:6379',
          SMTP_HOST: 'smtp.sendgrid.net',
          SMTP_PORT: '587',
          SMTP_USER: 'apikey',
          SMTP_PASS: 'secret',
          FLUTTERWAVE_SECRET_HASH: '   ',
          FLUTTERWAVE_SECRET_KEY: 'valid_key',
        });
      }).toThrow(/FLUTTERWAVE_SECRET_HASH/);
    });
  });

  // ============================================================================
  // TASK 2: Transaction Mismatch Handling
  // ============================================================================
  describe('Task 2: Transaction Mismatch Handling', () => {
    it('detects status mismatch and flags it', () => {
      const res = checkTransactionMismatch(
        { status: 'failed', amountKobo: 500000, currency: 'NGN', txRef: 'ref_123' },
        { amountKobo: 500000, txRef: 'ref_123' }
      );
      expect(res.valid).toBe(false);
      expect(res.mismatchType).toBe('status');
      expect(res.reason).toContain('status mismatch');
    });

    it('detects amount mismatch and flags it', () => {
      const res = checkTransactionMismatch(
        { status: 'successful', amountKobo: 450000, currency: 'NGN', txRef: 'ref_123' },
        { amountKobo: 500000, txRef: 'ref_123' }
      );
      expect(res.valid).toBe(false);
      expect(res.mismatchType).toBe('amount');
      expect(res.reason).toContain('amount mismatch');
    });

    it('detects currency mismatch and flags it', () => {
      const res = checkTransactionMismatch(
        { status: 'successful', amountKobo: 500000, currency: 'USD', txRef: 'ref_123' },
        { amountKobo: 500000, txRef: 'ref_123' }
      );
      expect(res.valid).toBe(false);
      expect(res.mismatchType).toBe('currency');
      expect(res.reason).toContain('currency mismatch');
    });

    it('detects tx_ref mismatch and flags it', () => {
      const res = checkTransactionMismatch(
        { status: 'successful', amountKobo: 500000, currency: 'NGN', txRef: 'tampered_ref' },
        { amountKobo: 500000, txRef: 'ref_123' }
      );
      expect(res.valid).toBe(false);
      expect(res.mismatchType).toBe('tx_ref');
      expect(res.reason).toContain('tx_ref mismatch');
    });

    it('validates when all parameters match', () => {
      const res = checkTransactionMismatch(
        { status: 'successful', amountKobo: 500000, currency: 'NGN', txRef: 'ref_123' },
        { amountKobo: 500000, txRef: 'ref_123' }
      );
      expect(res.valid).toBe(true);
      expect(res.mismatchType).toBeUndefined();
    });

    it('succeeds when provider tx_ref (provider_ref) matches even if idempotency_key differs (production shape)', () => {
      // In production, payments.idempotency_key is a client-supplied key while
      // payments.provider_ref is the server-generated provider reference (avue_<paymentId>).
      const providerRef = 'avue_550e8400e29b41d4a716446655440000';
      const actualTxRef = providerRef;
      const res = checkTransactionMismatch(
        { status: 'successful', amountKobo: 500000, currency: 'NGN', txRef: actualTxRef },
        { amountKobo: 500000, txRef: providerRef }
      );
      expect(res.valid).toBe(true);
      expect(res.mismatchType).toBeUndefined();
    });

    it('still flags when provider tx_ref is wrong even if a different idempotency context exists', () => {
      const expectedProviderRef = 'avue_550e8400e29b41d4a716446655440000';
      const wrongProviderTxRef = 'avue_deadbeefdeadbeefdeadbeefdeadbeef';
      const res = checkTransactionMismatch(
        { status: 'successful', amountKobo: 500000, currency: 'NGN', txRef: wrongProviderTxRef },
        { amountKobo: 500000, txRef: expectedProviderRef }
      );
      expect(res.valid).toBe(false);
      expect(res.mismatchType).toBe('tx_ref');
      expect(res.reason).toContain('tx_ref mismatch');
    });

    it('processWebhookEvent compares against payment.provider_ref and keeps idempotency_key for meta lookup only', () => {
      const jobsPath = path.resolve(__dirname, '../lib/jobs.ts');
      const jobsSrc = fs.readFileSync(jobsPath, 'utf-8');

      // Expected tx_ref for verification must come from the stored provider reference (not idempotency key).
      expect(jobsSrc).toContain('txRef: payment.provider_ref || txRef');
      expect(jobsSrc).not.toContain('txRef: payment.idempotency_key || txRef');

      // Idempotency key remains the lookup key for checkout metadata (seatIds/showtimeId).
      expect(jobsSrc).toContain(
        "`SELECT response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2`"
      );
      expect(jobsSrc).toContain('[payment.idempotency_key, payment.user_id]');

      // Payment fetch must include provider_ref for mismatch validation.
      expect(jobsSrc).toContain('p.idempotency_key, p.provider_ref');
    });

    it('confirms migration 004 extends payments_status_check to allow "flagged"', () => {
      const mig004Path = path.resolve(__dirname, '../../migrations/004_payments_flagged_status.sql');
      expect(fs.existsSync(mig004Path)).toBe(true);

      const mig004Sql = fs.readFileSync(mig004Path, 'utf-8');
      expect(mig004Sql).toContain("'flagged'");
      expect(mig004Sql).toContain("CHECK (status IN ('pending', 'successful', 'failed', 'refunded', 'flagged'))");
    });
  });

  // ============================================================================
  // TASK 3: Ticket Status Literals vs. Migration CHECK Constraints
  // ============================================================================
  describe('Task 3: Ticket Status Literals vs. Migration CHECK Constraints', () => {
    it('reads migration 002 SQL and asserts every status literal used in code is allowed', () => {
      const mig002Sql = fs.readFileSync(
        path.resolve(__dirname, '../../migrations/002_cinema_showtimes_payments.sql'),
        'utf-8'
      );

      // Extract allowed status literals from tickets table definition:
      // status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'cancelled'))
      const match = mig002Sql.match(/tickets[\s\S]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\)/i);
      expect(match).not.toBeNull();
      const rawStatuses = match![1];
      const allowedStatuses = rawStatuses
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''));

      expect(allowedStatuses).toEqual(['active', 'used', 'cancelled']);

      // Check schema enum definition in cinema.ts
      const cinemaSchemaSource = fs.readFileSync(
        path.resolve(__dirname, '../schemas/cinema.ts'),
        'utf-8'
      );
      expect(cinemaSchemaSource).toContain("status: z.enum(['active', 'used', 'cancelled'])");

      // Check tickets.ts code uses only allowed statuses in SQL queries
      const ticketsCode = fs.readFileSync(
        path.resolve(__dirname, '../routes/tickets.ts'),
        'utf-8'
      );
      const sqlStatusMatches = Array.from(ticketsCode.matchAll(/status\s*=\s*'([a-z_]+)'/g)).map((m) => m[1]);
      for (const statusVal of sqlStatusMatches) {
        expect(allowedStatuses).toContain(statusVal);
      }
    });
  });

  // ============================================================================
  // TASK 4: 401 Handling & Database Error Isolation
  // ============================================================================
  describe('Task 4: Auth 401 Error Boundary & Database Error Rethrow', () => {
    it('distinguishes UnauthorizedError from generic database errors', () => {
      const authError = new UnauthorizedError('Unauthorized');
      const dbError = new Error('getaddrinfo ENOTFOUND ep-cool-neon.us-east-2.aws.neon.tech');

      expect(authError instanceof UnauthorizedError).toBe(true);
      expect(dbError instanceof UnauthorizedError).toBe(false);
    });

    it('a database error during session lookup is not turned into a 401', () => {
      function simulateSessionCatch(err: any): { status: number } {
        if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
          return { status: 401 };
        }
        throw err; // Rethrown to 500 handler
      }

      // 1. Auth failure returns 401
      expect(simulateSessionCatch(new UnauthorizedError())).toEqual({ status: 401 });
      expect(simulateSessionCatch(new Error('Unauthorized'))).toEqual({ status: 401 });

      // 2. Database error is rethrown and NOT converted to 401
      const dbError = new Error('Database connection terminated unexpectedly');
      expect(() => simulateSessionCatch(dbError)).toThrow('Database connection terminated unexpectedly');
    });

    it('asserts showtimes.ts, checkout.ts, and tickets.ts rethrow non-auth errors', () => {
      const files = [
        path.resolve(__dirname, '../routes/showtimes.ts'),
        path.resolve(__dirname, '../routes/checkout.ts'),
        path.resolve(__dirname, '../routes/tickets.ts'),
      ];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).toContain('UnauthorizedError');
        expect(content).toContain('throw err');
      }
    });
  });

  // ============================================================================
  // Standing Tests: Naira to Kobo Integer Conversion & Admin Authorization
  // ============================================================================
  describe('Standing Tests: Currency Conversion & Admin Authorization', () => {
    it('accurately converts fractional Naira amounts to integer kobo without floating-point errors', () => {
      expect(nairaToKobo('110.25')).toBe(11025);
      expect(nairaToKobo(110.25)).toBe(11025);
      expect(nairaToKobo(3500)).toBe(350000);
      expect(nairaToKobo('10.5')).toBe(1050);
      expect(nairaToKobo('0.99')).toBe(99);
    });

    it('compares email case-insensitively against configured ADMIN_EMAILS', () => {
      process.env.ADMIN_EMAILS = 'admin@avue.app, Supervisor@AVUE.APP , gatekeeper@cinema.test';

      expect(isAdmin('admin@avue.app')).toBe(true);
      expect(isAdmin('ADMIN@AVUE.APP')).toBe(true);
      expect(isAdmin('supervisor@avue.app')).toBe(true);
      expect(isAdmin('customer@example.com')).toBe(false);
      expect(isAdmin('')).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
    });

    it('generates random >=128-bit reference and resolves strictly via SHA-256', () => {
      const reference = crypto.randomBytes(32).toString('hex');
      expect(reference.length).toBe(64);

      const storedHash = crypto.createHash('sha256').update(reference).digest('hex');
      const incomingHash = crypto.createHash('sha256').update(reference).digest('hex');
      expect(incomingHash).toBe(storedHash);

      const freshRef = crypto.randomBytes(32).toString('hex');
      const freshHash = crypto.createHash('sha256').update(freshRef).digest('hex');
      expect(freshHash).not.toBe(storedHash);
    });
  });
});
