import { describe, expect, it, vi, beforeEach } from 'vitest';
import { authRateLimit } from '../lib/rateLimit.js';
import * as redisModule from '../lib/redis.js';

describe('Auth Rate Limit via Redis Lua Script (Rule 02 & Task 7)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows requests within the configured RATE_LIMIT_AUTH_IP limit and atomically sets TTL', async () => {
    const mockRedis = {
      status: 'ready',
      eval: vi.fn().mockResolvedValue([1, 60]), // [count, ttl]
    };

    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    const mockRequest: any = { ip: '192.168.1.100', id: 'req_01' };
    const mockReply: any = {
      header: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await authRateLimit(mockRequest, mockReply);

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call(\'INCR\', KEYS[1])'),
      1,
      'rate_limit:auth:192.168.1.100',
      60,
    );
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('blocks with 429 and Retry-After header when rate limit is exceeded', async () => {
    const mockRedis = {
      status: 'ready',
      eval: vi.fn().mockResolvedValue([61, 42]), // [count: 61 > 60, ttl: 42]
    };

    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

    const mockRequest: any = { ip: '10.0.0.5', id: 'req_rate_01' };
    let sentStatus = 0;
    let sentBody: any = null;
    let setHeaders: Record<string, any> = {};

    const mockReply: any = {
      header: (key: string, val: any) => {
        setHeaders[key] = val;
      },
      status: (code: number) => {
        sentStatus = code;
        return {
          send: (body: any) => {
            sentBody = body;
          },
        };
      },
    };

    await authRateLimit(mockRequest, mockReply);

    expect(sentStatus).toBe(429);
    expect(setHeaders['Retry-After']).toBe(42);
    expect(sentBody.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(sentBody.error.requestId).toBe('req_rate_01');
  });

  it('fails closed with 503 when Redis is unreachable (Security Decision)', async () => {
    vi.spyOn(redisModule, 'getRedisClient').mockImplementation(() => {
      throw new Error('Connection refused to redis:6379');
    });

    const mockRequest: any = { ip: '10.0.0.6', id: 'req_fail_closed' };
    let sentStatus = 0;
    let sentBody: any = null;

    const mockReply: any = {
      header: vi.fn(),
      status: (code: number) => {
        sentStatus = code;
        return {
          send: (body: any) => {
            sentBody = body;
          },
        };
      },
    };

    await authRateLimit(mockRequest, mockReply);

    expect(sentStatus).toBe(503);
    expect(sentBody.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(sentBody.error.requestId).toBe('req_fail_closed');
  });
});
