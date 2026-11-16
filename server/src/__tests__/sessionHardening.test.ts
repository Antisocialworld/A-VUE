import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ServerBusyError,
  UnauthorizedError,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  revokeSession,
  revokeAllUserSessions,
  getSessionUser,
  _getActiveSessionVerifies,
  _getInFlightVerifies,
  _getVerifiedSessionCache,
  _resetSessionCache,
} from '../lib/session.js';
import * as db from '../lib/db.js';
import * as argon2Module from '../lib/argon2.js';
import { env } from '../env.js';
import { buildServer } from '../server.js';

describe('Session Verify Hardening & Sliding Cache (Task 2 & Task A/B)', () => {
  beforeEach(() => {
    _resetSessionCache();
    vi.restoreAllMocks();
    vi.spyOn(argon2Module, 'hashArgon2id').mockResolvedValue('mocked-hash');
  });

  afterEach(async () => {
    _resetSessionCache();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await db.writerPool.end().catch(() => {});
    if (db.readerPool && db.readerPool !== db.writerPool) {
      await db.readerPool.end().catch(() => {});
    }
  });

  describe('Sliding Cache with Hard Cap (Item a)', () => {
    it('renews idle window on cache hit but caps maximum lifetime at SESSION_CACHE_MAX_SECONDS', async () => {
      const cache = _getVerifiedSessionCache();
      const publicId = 'test-session-pub-1';
      const secret = 'test-session-sec-1';
      const now = Date.now();

      // Seed a verified session in cache
      cache.set(publicId, {
        userId: 'user-1',
        userEmail: 'user1@example.com',
        userStatus: 'active',
        secretHash: 'dummy_hash',
        secret,
        verifiedAt: now - 10000, // 10s ago
        lastAccessedAt: now - 10000,
        lastActiveAt: now - 10000,
        expiresAt: now + 86400000,
      });

      const mockReq: any = {
        headers: { authorization: `Bearer ${publicId}.${secret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      // 1. Hit within idle window (< 60s) and within max cap (< 300s)
      const user1 = await getSessionUser(mockReq);
      expect(user1.id).toBe('user-1');

      const entryAfterHit = cache.get(publicId)!;
      expect(entryAfterHit.lastAccessedAt).toBeGreaterThanOrEqual(now);
      // Hard cap verifiedAt remains anchored to original full verify time
      expect(entryAfterHit.verifiedAt).toBe(now - 10000);

      // 2. Idle window expired (> 60s since last access): must trigger full verify
      entryAfterHit.lastAccessedAt = Date.now() - (env.SESSION_CACHE_IDLE_SECONDS * 1000 + 1000);

      const dbQuerySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT')) {
          return {
            rows: [
              {
                user_id: 'user-1',
                secret_hash: 'dummy_hash',
                last_active_at: new Date(),
                expires_at: new Date(Date.now() + 86400000),
                email: 'user1@example.com',
                status: 'active',
              },
            ],
          } as any;
        }
        return { rows: [] } as any; // Handles UPDATE sessions SET last_active_at = NOW()
      });

      vi.spyOn(argon2Module, 'verifyArgon2id').mockResolvedValue(true);

      const user2 = await getSessionUser(mockReq);
      expect(user2.id).toBe('user-1');
      expect(dbQuerySpy).toHaveBeenCalled();

      // 3. Hard cap expired (> 300s since verifiedAt): even if lastAccessedAt is fresh, triggers full verify
      const refreshedEntry = cache.get(publicId)!;
      refreshedEntry.verifiedAt = Date.now() - (env.SESSION_CACHE_MAX_SECONDS * 1000 + 1000);
      refreshedEntry.lastAccessedAt = Date.now(); // Fresh idle access

      const user3 = await getSessionUser(mockReq);
      expect(user3.id).toBe('user-1');
      expect(dbQuerySpy).toHaveBeenCalled();
    });
  });

  describe('Revocation Cache Eviction (Item b)', () => {
    it('revokeSession evicts entry from verifiedSessionCache and inFlightVerifies', async () => {
      const cache = _getVerifiedSessionCache();
      const inFlight = _getInFlightVerifies();
      const publicId = 'session-to-revoke';

      cache.set(publicId, {
        userId: 'user-rev',
        userEmail: 'rev@example.com',
        userStatus: 'active',
        secretHash: 'hash',
        secret: 'sec',
        verifiedAt: Date.now(),
        lastAccessedAt: Date.now(),
        lastActiveAt: Date.now(),
        expiresAt: Date.now() + 10000,
      });

      inFlight.set(publicId, {
        secret: 'sec',
        promise: Promise.resolve({ id: 'user-rev', email: 'rev@example.com', status: 'active' }),
      });

      const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] } as any);

      await revokeSession(publicId);

      expect(cache.has(publicId)).toBe(false);
      expect(inFlight.has(publicId)).toBe(false);
      expect(querySpy).toHaveBeenCalledWith('DELETE FROM sessions WHERE id = $1;', [publicId]);
    });

    it('revokeAllUserSessions evicts all sessions for a user from cache and inFlightVerifies', async () => {
      const cache = _getVerifiedSessionCache();
      const inFlight = _getInFlightVerifies();

      cache.set('s1', {
        userId: 'target-user',
        userEmail: 'target@example.com',
        userStatus: 'active',
        secretHash: 'h1',
        secret: 'sec1',
        verifiedAt: Date.now(),
        lastAccessedAt: Date.now(),
        lastActiveAt: Date.now(),
        expiresAt: Date.now() + 10000,
      });

      cache.set('s2', {
        userId: 'target-user',
        userEmail: 'target@example.com',
        userStatus: 'active',
        secretHash: 'h2',
        secret: 'sec2',
        verifiedAt: Date.now(),
        lastAccessedAt: Date.now(),
        lastActiveAt: Date.now(),
        expiresAt: Date.now() + 10000,
      });

      cache.set('other-s', {
        userId: 'other-user',
        userEmail: 'other@example.com',
        userStatus: 'active',
        secretHash: 'h3',
        secret: 'sec3',
        verifiedAt: Date.now(),
        lastAccessedAt: Date.now(),
        lastActiveAt: Date.now(),
        expiresAt: Date.now() + 10000,
      });

      inFlight.set('s1', {
        secret: 'sec1',
        promise: Promise.resolve({ id: 'target-user', email: 'target@example.com', status: 'active' }),
      });

      const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] } as any);

      await revokeAllUserSessions('target-user');

      expect(cache.has('s1')).toBe(false);
      expect(cache.has('s2')).toBe(false);
      expect(inFlight.has('s1')).toBe(false);
      expect(cache.has('other-s')).toBe(true);
      expect(querySpy).toHaveBeenCalledWith('DELETE FROM sessions WHERE user_id = $1;', ['target-user']);
    });
  });

  describe('Dedupe Concurrent Verifies & Auth-Bypass Protection (Task A & Task 2c)', () => {
    it('(1) N concurrent requests with same publicId and same secret cause exactly one Argon2 verify', async () => {
      const publicId = 'concurrent-pub';
      const secret = 'concurrent-sec';

      let resolveVerify: (val: boolean) => void;
      const verifyPromise = new Promise<boolean>((resolve) => {
        resolveVerify = resolve;
      });

      const dbQuerySpy = vi.spyOn(db, 'query').mockResolvedValue({
        rows: [
          {
            user_id: 'user-conc',
            secret_hash: 'hash-conc',
            last_active_at: new Date(),
            expires_at: new Date(Date.now() + 86400000),
            email: 'conc@example.com',
            status: 'active',
          },
        ],
      } as any);

      const argonVerifySpy = vi.spyOn(argon2Module, 'verifyArgon2id').mockImplementation(async () => {
        return await verifyPromise;
      });

      const mockReq: any = {
        headers: { authorization: `Bearer ${publicId}.${secret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      // Launch 3 concurrent requests for the same session with identical secret
      const req1 = getSessionUser(mockReq);
      const req2 = getSessionUser(mockReq);
      const req3 = getSessionUser(mockReq);

      // In-flight map contains entry with stored secret and promise
      const inFlight = _getInFlightVerifies();
      expect(inFlight.has(publicId)).toBe(true);
      expect(inFlight.get(publicId)?.secret).toBe(secret);

      // Complete verify
      resolveVerify!(true);

      const [res1, res2, res3] = await Promise.all([req1, req2, req3]);
      expect(res1.id).toBe('user-conc');
      expect(res2.id).toBe('user-conc');
      expect(res3.id).toBe('user-conc');

      // Exactly ONE Argon2 verify was performed for all 3 concurrent requests
      expect(argonVerifySpy).toHaveBeenCalledTimes(1);

      // In-flight entry removed on completion
      expect(inFlight.has(publicId)).toBe(false);
    });

    it('(2) concurrent request with same publicId and wrong secret throws UnauthorizedError and never receives the user', async () => {
      const publicId = 'auth-bypass-pub';
      const realSecret = 'legitimate-secret-123';
      const wrongSecret = 'attacker-wrong-secret-999';

      let resolveRealVerify: (val: boolean) => void;
      const realVerifyPromise = new Promise<boolean>((resolve) => {
        resolveRealVerify = resolve;
      });

      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT s.user_id')) {
          return {
            rows: [
              {
                user_id: 'real-user',
                secret_hash: 'real-hash',
                last_active_at: new Date(),
                expires_at: new Date(Date.now() + 86400000),
                email: 'real@example.com',
                status: 'active',
              },
            ],
          } as any;
        }
        return { rows: [] } as any;
      });

      // Argon2 verify mock: succeeds only for realSecret
      const argonVerifySpy = vi.spyOn(argon2Module, 'verifyArgon2id').mockImplementation(async (_hash: string, plain: string) => {
        if (plain === realSecret) {
          return await realVerifyPromise;
        }
        // Wrong secret fails Argon2 verification
        return false;
      });

      const legitimateReq: any = {
        headers: { authorization: `Bearer ${publicId}.${realSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      const attackerReq: any = {
        headers: { authorization: `Bearer ${publicId}.${wrongSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      // 1. Launch legitimate request (enters inFlightVerifies)
      const legPromise = getSessionUser(legitimateReq);

      const inFlight = _getInFlightVerifies();
      expect(inFlight.has(publicId)).toBe(true);
      expect(inFlight.get(publicId)?.secret).toBe(realSecret);

      // 2. Launch attacker request concurrently with WRONG secret
      const attPromise = getSessionUser(attackerReq);

      // 3. Complete legitimate verify
      resolveRealVerify!(true);

      // Legitimate user authenticates
      const legUser = await legPromise;
      expect(legUser.id).toBe('real-user');

      // Attacker is rejected with UnauthorizedError and NEVER receives user
      await expect(attPromise).rejects.toThrow(UnauthorizedError);

      // Attacker ran its own verify and did NOT piggyback on legitimate request
      expect(argonVerifySpy).toHaveBeenCalledWith('real-hash', realSecret);
      expect(argonVerifySpy).toHaveBeenCalledWith('real-hash', wrongSecret);
    });

    it('removes entry from in-flight map when verify fails so failure is not cached', async () => {
      const publicId = 'fail-pub';
      const secret = 'fail-sec';

      const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-fail',
            secret_hash: 'hash-fail',
            last_active_at: new Date(),
            expires_at: new Date(Date.now() + 86400000),
            email: 'fail@example.com',
            status: 'active',
          },
        ],
      } as any);

      vi.spyOn(argon2Module, 'verifyArgon2id').mockResolvedValueOnce(false);

      const mockReq: any = {
        headers: { authorization: `Bearer ${publicId}.${secret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      await expect(getSessionUser(mockReq)).rejects.toThrow(UnauthorizedError);

      const inFlight = _getInFlightVerifies();
      const cache = _getVerifiedSessionCache();
      expect(inFlight.has(publicId)).toBe(false);
      expect(cache.has(publicId)).toBe(false);
      // Task F: revokeSession must NOT be called on secret failure (DELETE query not executed)
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(querySpy).not.toHaveBeenCalledWith(expect.stringContaining('DELETE'), expect.anything());
    });
  });

  describe('Bounded Wait, 503 SERVER_BUSY & Retry-After (Task B & Task 2d)', () => {
    it('ServerBusyError exposes status 503, code SERVER_BUSY, and Retry-After header', () => {
      const err = new ServerBusyError('Server is busy.');
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('SERVER_BUSY');
      expect(err.retryAfter).toBe(2);
      expect(err.headers['Retry-After']).toBe('2');
    });

    it('acquireConcurrencySlot throws ServerBusyError when wait time exceeds SESSION_VERIFY_MAX_WAIT_MS', async () => {
      const originalMax = env.ARGON2_MAX_CONCURRENCY;
      const originalWait = env.SESSION_VERIFY_MAX_WAIT_MS;

      (env as any).ARGON2_MAX_CONCURRENCY = 1;
      (env as any).SESSION_VERIFY_MAX_WAIT_MS = 50; // short wait for test

      try {
        await acquireConcurrencySlot();
        expect(_getActiveSessionVerifies()).toBe(1);

        // Next acquire should wait and timeout after 50ms
        await expect(acquireConcurrencySlot()).rejects.toThrow(ServerBusyError);
      } finally {
        releaseConcurrencySlot();
        (env as any).ARGON2_MAX_CONCURRENCY = originalMax;
        (env as any).SESSION_VERIFY_MAX_WAIT_MS = originalWait;
      }
    });

    it('server error handler sends status 503, own message, code SERVER_BUSY, and Retry-After header for ServerBusyError', async () => {
      vi.spyOn(argon2Module, 'hashArgon2id').mockResolvedValue('mocked-hash');
      const server = await buildServer();

      // Register route that throws ServerBusyError
      server.get('/test-server-busy', async () => {
        throw new ServerBusyError('Server is currently saturated with verifications. Please retry.');
      });

      const res = await server.inject({
        method: 'GET',
        url: '/test-server-busy',
      });

      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('2');

      const body = res.json();
      expect(body.error.code).toBe('SERVER_BUSY');
      expect(body.error.message).toBe('Server is currently saturated with verifications. Please retry.');
      expect(body.error.requestId).toBeDefined();

      await server.close();
    });

    it('server error handler keeps generic masking for non-ServerBusy 5xx errors', async () => {
      vi.spyOn(argon2Module, 'hashArgon2id').mockResolvedValue('mocked-hash');
      const server = await buildServer();

      server.get('/test-generic-500', async () => {
        throw new Error('Database password connection timeout at pg:5432');
      });

      const res = await server.inject({
        method: 'GET',
        url: '/test-generic-500',
      });

      expect(res.statusCode).toBe(500);
      expect(res.headers['retry-after']).toBeUndefined();

      const body = res.json();
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(body.error.message).toBe('An internal server error occurred.');
      expect(body.error.message).not.toContain('Database password');
      expect(body.error.requestId).toBeDefined();

      await server.close();
    });
  });

  describe('Verify Secret on Cache Hit (Task D)', () => {
    it('(1) hit with right secret returns user', async () => {
      const cache = _getVerifiedSessionCache();
      const publicId = 'valid-cache-pub';
      const secret = 'valid-cache-sec';
      const now = Date.now();

      cache.set(publicId, {
        userId: 'user-valid',
        userEmail: 'valid@example.com',
        userStatus: 'active',
        secretHash: 'some_hash',
        secret,
        verifiedAt: now,
        lastAccessedAt: now,
        lastActiveAt: now,
        expiresAt: now + 86400000,
      });

      const mockReq: any = {
        headers: { authorization: `Bearer ${publicId}.${secret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      const user = await getSessionUser(mockReq);
      expect(user.id).toBe('user-valid');
      expect(user.email).toBe('valid@example.com');
      expect(user.status).toBe('active');
    });

    it('(2) hit with wrong secret throws UnauthorizedError, cache entry remains present, and revokeSession / DB delete are not called', async () => {
      const cache = _getVerifiedSessionCache();
      const publicId = 'victim-cache-pub';
      const legitimateSecret = 'legitimate-user-sec';
      const wrongSecret = 'attacker-guessed-sec';
      const now = Date.now();

      cache.set(publicId, {
        userId: 'victim-user',
        userEmail: 'victim@example.com',
        userStatus: 'active',
        secretHash: 'victim_hash',
        secret: legitimateSecret,
        verifiedAt: now,
        lastAccessedAt: now,
        lastActiveAt: now,
        expiresAt: now + 86400000,
      });

      const dbQuerySpy = vi.spyOn(db, 'query');
      const argonVerifySpy = vi.spyOn(argon2Module, 'verifyArgon2id');

      const attackerReq: any = {
        headers: { authorization: `Bearer ${publicId}.${wrongSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      await expect(getSessionUser(attackerReq)).rejects.toThrow(UnauthorizedError);

      // Cache entry remains present and intact for the legitimate user
      expect(cache.has(publicId)).toBe(true);
      const cached = cache.get(publicId);
      expect(cached?.secret).toBe(legitimateSecret);

      // Neither revokeSession nor DB delete was called
      expect(dbQuerySpy).not.toHaveBeenCalled();

      // Argon2 was NOT run
      expect(argonVerifySpy).not.toHaveBeenCalled();
    });

    it('(3) after wrong-secret attempt, right secret still works from cache', async () => {
      const cache = _getVerifiedSessionCache();
      const publicId = 'resilient-cache-pub';
      const legitimateSecret = 'resilient-user-sec';
      const wrongSecret = 'attacker-bad-sec';
      const now = Date.now();

      cache.set(publicId, {
        userId: 'resilient-user',
        userEmail: 'resilient@example.com',
        userStatus: 'active',
        secretHash: 'resilient_hash',
        secret: legitimateSecret,
        verifiedAt: now,
        lastAccessedAt: now,
        lastActiveAt: now,
        expiresAt: now + 86400000,
      });

      const dbQuerySpy = vi.spyOn(db, 'query');

      // 1. Wrong secret attempt fails
      const attackerReq: any = {
        headers: { authorization: `Bearer ${publicId}.${wrongSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };
      await expect(getSessionUser(attackerReq)).rejects.toThrow(UnauthorizedError);

      // 2. Legitimate secret request immediately succeeds from cache
      const legitimateReq: any = {
        headers: { authorization: `Bearer ${publicId}.${legitimateSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };
      const user = await getSessionUser(legitimateReq);
      expect(user.id).toBe('resilient-user');
      expect(user.email).toBe('resilient@example.com');

      // Cache hit served without querying DB or invoking Argon2
      expect(dbQuerySpy).not.toHaveBeenCalled();
    });
  });

  describe('Full Session Verify Hardening: No Revocation on Wrong Secret (Task F)', () => {
    it('(1) cache miss with a wrong secret throws UnauthorizedError, and the database row, cache entry and revokeSession are untouched', async () => {
      const publicId = 'task-f-pub-1';
      const rightSecret = 'real-secret-1';
      const wrongSecret = 'wrong-secret-1';

      const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT s.user_id')) {
          return {
            rows: [
              {
                user_id: 'real-user-1',
                secret_hash: 'real-hash-1',
                last_active_at: new Date(),
                expires_at: new Date(Date.now() + 86400000),
                email: 'real1@example.com',
                status: 'active',
              },
            ],
          } as any;
        }
        return { rows: [] } as any;
      });

      const argonSpy = vi.spyOn(argon2Module, 'verifyArgon2id').mockImplementation(async (_hash, plain) => {
        return plain === rightSecret;
      });

      const mockReq: any = {
        headers: { authorization: `Bearer ${publicId}.${wrongSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      await expect(getSessionUser(mockReq)).rejects.toThrow(UnauthorizedError);

      expect(argonSpy).toHaveBeenCalledWith('real-hash-1', wrongSecret);

      // Verify revokeSession was NOT called (no DELETE query executed)
      const deleteCalls = querySpy.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM sessions'));
      expect(deleteCalls.length).toBe(0);

      // Cache does NOT contain entry for this failed verify
      const cache = _getVerifiedSessionCache();
      expect(cache.has(publicId)).toBe(false);
    });

    it('(2) after a wrong-secret attempt on cache miss, the right secret still verifies', async () => {
      const publicId = 'task-f-pub-2';
      const rightSecret = 'real-secret-2';
      const wrongSecret = 'wrong-secret-2';

      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT s.user_id')) {
          return {
            rows: [
              {
                user_id: 'real-user-2',
                secret_hash: 'real-hash-2',
                last_active_at: new Date(),
                expires_at: new Date(Date.now() + 86400000),
                email: 'real2@example.com',
                status: 'active',
              },
            ],
          } as any;
        }
        return { rows: [] } as any;
      });

      vi.spyOn(argon2Module, 'verifyArgon2id').mockImplementation(async (_hash, plain) => {
        return plain === rightSecret;
      });

      // 1. Wrong secret attempt fails
      const attackerReq: any = {
        headers: { authorization: `Bearer ${publicId}.${wrongSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };
      await expect(getSessionUser(attackerReq)).rejects.toThrow(UnauthorizedError);

      // 2. Right secret succeeds immediately
      const legitimateReq: any = {
        headers: { authorization: `Bearer ${publicId}.${rightSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };
      const user = await getSessionUser(legitimateReq);
      expect(user.id).toBe('real-user-2');
      expect(user.email).toBe('real2@example.com');

      // Verified session is now cached with the right secret
      const cache = _getVerifiedSessionCache();
      expect(cache.has(publicId)).toBe(true);
      expect(cache.get(publicId)?.secret).toBe(rightSecret);
    });

    it('(3) a concurrent request with the same publicId and a wrong secret (Task A path) does not revoke the real session', async () => {
      const publicId = 'task-f-pub-3';
      const rightSecret = 'legitimate-secret-3';
      const wrongSecret = 'attacker-secret-3';

      let resolveRealVerify: (val: boolean) => void;
      const realVerifyPromise = new Promise<boolean>((resolve) => {
        resolveRealVerify = resolve;
      });

      const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT s.user_id')) {
          return {
            rows: [
              {
                user_id: 'real-user-3',
                secret_hash: 'real-hash-3',
                last_active_at: new Date(),
                expires_at: new Date(Date.now() + 86400000),
                email: 'real3@example.com',
                status: 'active',
              },
            ],
          } as any;
        }
        return { rows: [] } as any;
      });

      vi.spyOn(argon2Module, 'verifyArgon2id').mockImplementation(async (_hash, plain) => {
        if (plain === rightSecret) {
          return await realVerifyPromise;
        }
        return false;
      });

      const legitimateReq: any = {
        headers: { authorization: `Bearer ${publicId}.${rightSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      const attackerReq: any = {
        headers: { authorization: `Bearer ${publicId}.${wrongSecret}` },
        raw: { res: { setHeader: vi.fn() } },
        log: { error: vi.fn() },
      };

      // 1. Start legitimate request
      const legPromise = getSessionUser(legitimateReq);

      // 2. Start concurrent attacker request with wrong secret
      const attPromise = getSessionUser(attackerReq);

      // Attacker request fails with UnauthorizedError
      await expect(attPromise).rejects.toThrow(UnauthorizedError);

      // RevokeSession must NOT have been called
      const deleteCalls = querySpy.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM sessions'));
      expect(deleteCalls.length).toBe(0);

      // 3. Resolve legitimate request
      resolveRealVerify!(true);
      const legUser = await legPromise;
      expect(legUser.id).toBe('real-user-3');

      // The real session is now cached and valid
      const cache = _getVerifiedSessionCache();
      expect(cache.has(publicId)).toBe(true);
      expect(cache.get(publicId)?.secret).toBe(rightSecret);
    });
  });
});
