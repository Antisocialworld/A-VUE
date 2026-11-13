import { describe, expect, it, vi, beforeEach } from 'vitest';
import { consumeEmailSendSlot, resetSendCap } from '../lib/sendCap.js';
import * as redisModule from '../lib/redis.js';
import * as argon2Module from '../lib/argon2.js';
import * as mailerModule from '../lib/mailer.js';
import * as dbModule from '../lib/db.js';
import { buildServer } from '../server.js';
import { env } from '../env.js';

describe('Sign-up Atomic Send Cap, Cooldown, and Error Handling (Task 1 & 2)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  it('atomic Lua script handles parallel requests: exactly one succeeds and others hit cooldown (Task 1)', async () => {
    const testEmail = 'parallel-test@example.com';
    let cooldownTtl = 0;
    let dailyCount = 0;

    // Mock Redis eval implementing the atomic Lua script behaviour
    const mockRedis = {
      status: 'ready',
      eval: vi.fn().mockImplementation(async (_script, _keyCount, _cooldownKey, _dailyKey, cooldownSec, dailyCap) => {
        if (cooldownTtl > 0) {
          return [0, 'cooldown', cooldownTtl, dailyCount];
        }
        if (dailyCount >= dailyCap) {
          return [0, 'daily_cap', 0, dailyCount];
        }
        cooldownTtl = Number(cooldownSec);
        dailyCount += 1;
        return [1, 'allowed', cooldownSec, dailyCount];
      }),
    };
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    // Run 5 parallel requests simultaneously
    const results = await Promise.all([
      consumeEmailSendSlot(testEmail),
      consumeEmailSendSlot(testEmail),
      consumeEmailSendSlot(testEmail),
      consumeEmailSendSlot(testEmail),
      consumeEmailSendSlot(testEmail),
    ]);

    const allowedCount = results.filter((r) => r.allowed).length;
    const cooldownCount = results.filter((r) => !r.allowed && r.reason === 'cooldown').length;

    expect(allowedCount).toBe(1);
    expect(cooldownCount).toBe(4);
  });

  it('enforces cap boundary: exactly DAILY_CODE_SEND_CAP requests allowed, then daily_cap (Task 1)', async () => {
    const testEmail = 'cap-boundary@example.com';
    let cooldownTtl = 0;
    let dailyCount = 0;

    const mockRedis = {
      status: 'ready',
      eval: vi.fn().mockImplementation(async (_script, _keyCount, _cooldownKey, _dailyKey, cooldownSec, dailyCap) => {
        if (cooldownTtl > 0) {
          return [0, 'cooldown', cooldownTtl, dailyCount];
        }
        if (dailyCount >= dailyCap) {
          return [0, 'daily_cap', 0, dailyCount];
        }
        cooldownTtl = Number(cooldownSec);
        dailyCount += 1;
        return [1, 'allowed', cooldownSec, dailyCount];
      }),
    };
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    // Call 1..DAILY_CODE_SEND_CAP with cooldown expiring between each
    for (let i = 1; i <= env.DAILY_CODE_SEND_CAP; i++) {
      cooldownTtl = 0; // Simulate cooldown expiration
      const slot = await consumeEmailSendSlot(testEmail);
      expect(slot.allowed).toBe(true);
      expect(slot.dailyCount).toBe(i);
    }

    // Call 6 (beyond cap): rejected with daily_cap
    cooldownTtl = 0;
    const cappedSlot = await consumeEmailSendSlot(testEmail);
    expect(cappedSlot.allowed).toBe(false);
    expect(cappedSlot.reason).toBe('daily_cap');
  });

  it('no in-memory fallback: if Redis is unreachable, sends no mail, logs error class only, returns 200 without throwing 500 (Task 2)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const redisError = new Error('Connection refused');
    redisError.name = 'RedisConnectionError';

    const mockRedis = {
      status: 'ready',
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn().mockImplementation((_script: string, _numkeys: number, ...args: any[]) => {
        // Allow rate limiter to pass so request reaches send-cap logic
        if (typeof args[0] === 'string' && args[0].startsWith('rate_limit:auth:')) {
          return [1, 60];
        }
        // Send-cap script triggers Redis failure
        throw redisError;
      }),
    };
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    // 1. consumeEmailSendSlot directly: logs single line with error class only
    const slot = await consumeEmailSendSlot('unreachable@example.com');
    expect(slot.allowed).toBe(false);
    expect(slot.reason).toBe('redis_unreachable');

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const logged = stderrSpy.mock.calls[0][0] as string;
    expect(logged).toBe('[SendCap Error] RedisConnectionError\n');
    expect(logged).not.toContain('unreachable@example.com'); // No recipient leak

    // 2. Route level: POST /auth/signup returns normal 200 success without throwing 500
    const server = await buildServer();
    vi.spyOn(argon2Module, 'hashArgon2id').mockResolvedValue('mocked-hash');
    const noticeMailSpy = vi.spyOn(mailerModule, 'sendAccountExistsNoticeEmail').mockResolvedValue({ success: true });
    const codeMailSpy = vi.spyOn(mailerModule, 'sendVerificationCodeEmail').mockResolvedValue({ success: true });

    vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as any);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'unreachable@example.com', password: 'ValidPassword123!' },
    });

    expect(res.statusCode).toBe(200);
    expect(noticeMailSpy).toHaveBeenCalledTimes(0);
    expect(codeMailSpy).toHaveBeenCalledTimes(0);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({
      message: 'Verification code sent to email',
      email: 'unreachable@example.com',
      cooldownSeconds: 60,
    });

    await server.close();
    stderrSpy.mockRestore();
  });

  it('fails closed with generic 503 when Redis is down for auth IP rate limiter (Task 2)', async () => {
    const redisError = new Error('Connection refused');
    redisError.name = 'RedisConnectionError';

    const mockRedis = {
      status: 'connecting',
      connect: vi.fn().mockRejectedValue(redisError),
      eval: vi.fn().mockRejectedValue(redisError),
    };
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    const server = await buildServer();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'ratelimit-down@example.com', password: 'ValidPassword123!' },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.message).toBe('Authentication service temporarily unavailable. Please try again later.');

    await server.close();
  });

  it('runs Argon2id hash on both new and existing email sign-up branches (Task 3)', async () => {
    const server = await buildServer();
    const hashSpy = vi.spyOn(argon2Module, 'hashArgon2id').mockResolvedValue('mocked-argon2-hash');
    vi.spyOn(mailerModule, 'sendAccountExistsNoticeEmail').mockResolvedValue({ success: true });
    vi.spyOn(mailerModule, 'sendVerificationCodeEmail').mockResolvedValue({ success: true });

    const mockRedis = {
      status: 'ready',
      eval: vi.fn().mockResolvedValue([1, 'allowed', 60, 1]),
    };
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    // Branch A: Existing user
    const existingEmail = 'existing-user@example.com';
    vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
      rows: [{ id: 'user-uuid-1' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as any);

    const resExisting = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: existingEmail,
        password: 'ValidPassword123!',
      },
    });

    expect(resExisting.statusCode).toBe(200);
    expect(hashSpy).toHaveBeenCalledWith('ValidPassword123!');
    const existingBody = JSON.parse(resExisting.payload);
    expect(existingBody).toEqual({
      message: 'Verification code sent to email',
      email: existingEmail,
      cooldownSeconds: 60,
    });

    // Branch B: New user
    hashSpy.mockClear();
    const newEmail = 'brand-new-user@example.com';
    vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as any);

    const resNew = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: newEmail,
        password: 'ValidPassword123!',
      },
    });

    expect(resNew.statusCode).toBe(200);
    expect(hashSpy).toHaveBeenCalledWith('ValidPassword123!');
    const newBody = JSON.parse(resNew.payload);
    expect(newBody).toEqual({
      message: 'Verification code sent to email',
      email: newEmail,
      cooldownSeconds: 60,
    });

    await server.close();
  });
});
