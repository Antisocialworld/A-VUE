import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkoutRateLimit: vi.fn(),
  dbQuery: vi.fn(),
  env: {
    APP_RETURN_URL: undefined as string | undefined,
    NODE_ENV: 'test' as const,
  },
}));

vi.mock('../env.js', () => ({ env: mocks.env, isAdmin: vi.fn() }));
vi.mock('../lib/rateLimit.js', () => ({ checkoutRateLimit: mocks.checkoutRateLimit }));
vi.mock('../lib/db.js', () => ({ writerPool: { query: mocks.dbQuery } }));

import Fastify from 'fastify';
import { writerPool } from '../lib/db.js';
import { paymentCallbackRoutes, DEFAULT_APP_RETURN_URL } from '../routes/paymentCallback.js';

describe('Public GET /payments/callback', () => {
  let app: any;

  beforeEach(() => {
    mocks.env.APP_RETURN_URL = undefined;
    mocks.checkoutRateLimit.mockReset().mockResolvedValue(true);
    mocks.dbQuery.mockReset();
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.clearAllMocks();
  });

  it('returns 200 HTML with no DB call, no cookies and no query echo', async () => {
    app = Fastify();
    await app.register(paymentCallbackRoutes);

    const hostileRef = encodeURIComponent('<script>alert(1)</script>');
    const res = await app.inject({
      method: 'GET',
      url: `/payments/callback?tx_ref=${hostileRef}&status=successful&redirect=https://evil.example`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(mocks.checkoutRateLimit).toHaveBeenCalledTimes(1);
    expect(writerPool.query).not.toHaveBeenCalled();
    expect(res.body).toContain('Payment received');
    expect(res.body).toContain('Return to A VUE');
    expect(res.body).toContain(DEFAULT_APP_RETURN_URL);
    expect(res.body).not.toContain('alert(1)');
    expect(res.body).not.toContain('successful');
    expect(res.body).not.toContain('evil.example');
  });

  it('uses APP_RETURN_URL from server config only', async () => {
    mocks.env.APP_RETURN_URL = 'exp+avue://payment-return';
    app = Fastify();
    await app.register(paymentCallbackRoutes);

    const res = await app.inject({
      method: 'GET',
      url: '/payments/callback?redirect=https://evil.example',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('exp+avue://payment-return');
    expect(res.body).not.toMatch(/(["'])avue:\/\/payment-return\1/);
    expect(res.body).not.toContain('evil.example');
  });

  it('has no auth hook and does not import ticket issuance or database modules', () => {
    const routeSrc = fs.readFileSync(
      path.resolve(__dirname, '../routes/paymentCallback.ts'),
      'utf-8',
    );
    expect(routeSrc).not.toContain('getSessionUser');
    expect(routeSrc).not.toContain('processWebhookEvent');
    expect(routeSrc).not.toContain('writerPool.query');
    expect(routeSrc).not.toContain('request.query');
  });
});
