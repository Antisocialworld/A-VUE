import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  env: {
    PAYMENT_SIMULATOR: false,
    FLUTTERWAVE_SECRET_KEY: 'dummy',
  },
  isAdmin: vi.fn(),
}));
vi.mock('../lib/db.js', () => ({ writerPool: { query: vi.fn() } }));
vi.mock('../lib/redis.js', () => ({ getRedisClient: vi.fn() }));
vi.mock('../lib/flutterwaveEvents.js', () => ({
  recordAndQueueFlutterwaveEvent: vi.fn(),
}));

import { env } from '../env.js';
import { writerPool } from '../lib/db.js';
import { getRedisClient } from '../lib/redis.js';
import { recordAndQueueFlutterwaveEvent } from '../lib/flutterwaveEvents.js';
import {
  PAYMENT_VERIFY_MIN_AGE_SECONDS,
  runPendingPaymentVerificationFallback,
  verifyAndRecordPendingPayment,
} from '../lib/paymentVerificationFallback.js';

const PAYMENT = {
  id: 'pay-1',
  provider_ref: 'avue_abc123',
  amount_kobo: 10000,
  currency: 'NGN',
};

const DEFAULT_VERIFIED_DATA = {
  id: 424242,
  tx_ref: PAYMENT.provider_ref,
  status: 'successful',
  amount: '100.00',
  currency: 'NGN',
};

let fetchMock: ReturnType<typeof vi.fn>;
let stderrWrite: any;

function fwResponse(data: Record<string, unknown> = DEFAULT_VERIFIED_DATA) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data }),
  } as any;
}

function mockRedis(setImpl: any) {
  const set = vi.fn(setImpl);
  vi.mocked(getRedisClient).mockReturnValue({ status: 'ready', set } as any);
  return set;
}

async function flushBackgroundJobs() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

beforeEach(() => {
  (env as any).PAYMENT_SIMULATOR = false;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((() => true) as any);

  vi.mocked(writerPool.query).mockReset();
  vi.mocked(getRedisClient).mockReset();
  vi.mocked(recordAndQueueFlutterwaveEvent).mockReset();
  vi.mocked(recordAndQueueFlutterwaveEvent).mockResolvedValue({
    inserted: true,
    eventId: '424242',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Pending-payment Flutterwave verify fallback', () => {
  it('verifies a matching successful payment once through the shared event path', async () => {
    fetchMock.mockResolvedValue(fwResponse());

    await verifyAndRecordPendingPayment(PAYMENT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v3/transactions/verify_by_reference?tx_ref=avue_abc123');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dummy');
    expect(init.signal).toBeDefined();

    expect(recordAndQueueFlutterwaveEvent).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(recordAndQueueFlutterwaveEvent).mock.calls[0][0];
    expect(payload.event).toBe('charge.completed');
    expect(payload.data.id).toBe(424242);
    expect(payload.data.tx_ref).toBe(PAYMENT.provider_ref);
    expect(payload.data.status).toBe('successful');
    expect(payload.data.currency).toBe('NGN');
  });

  it('does nothing when the real webhook already inserted the event', async () => {
    fetchMock.mockResolvedValue(fwResponse());
    vi.mocked(recordAndQueueFlutterwaveEvent).mockResolvedValue({
      inserted: false,
      eventId: '424242',
    });

    await verifyAndRecordPendingPayment(PAYMENT);

    expect(recordAndQueueFlutterwaveEvent).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      '[Payment Verify Fallback] outcome=skipped reason=webhook_won\n',
    );
  });

  it.each([
    ['amount mismatch', { amount: '90.00' }, 'amount_mismatch'],
    ['wrong currency', { currency: 'USD' }, 'currency_mismatch'],
    ['failed status', { status: 'failed' }, 'status_not_successful'],
  ])('leaves payment pending on %s', async (_label, dataOverrides, reason) => {
    fetchMock.mockResolvedValue(fwResponse({ ...DEFAULT_VERIFIED_DATA, ...dataOverrides }));

    await verifyAndRecordPendingPayment(PAYMENT);

    expect(recordAndQueueFlutterwaveEvent).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(
      `[Payment Verify Fallback] outcome=skipped reason=${reason}\n`,
    );
  });

  it('leaves payment pending on wrong tx_ref', async () => {
    fetchMock.mockResolvedValue(
      fwResponse({ ...DEFAULT_VERIFIED_DATA, tx_ref: 'avue_other' }),
    );

    await verifyAndRecordPendingPayment(PAYMENT);

    expect(recordAndQueueFlutterwaveEvent).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(
      '[Payment Verify Fallback] outcome=skipped reason=tx_ref_mismatch\n',
    );
  });

  it('leaves payment pending on a 5s timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const verifyPromise = verifyAndRecordPendingPayment(PAYMENT);
    await vi.advanceTimersByTimeAsync(5000);
    await verifyPromise;

    expect(recordAndQueueFlutterwaveEvent).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(
      '[Payment Verify Fallback] outcome=skipped reason=timeout\n',
    );
  });

  it('leaves payment pending on non-200 response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '',
    });

    await verifyAndRecordPendingPayment(PAYMENT);

    expect(recordAndQueueFlutterwaveEvent).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(
      '[Payment Verify Fallback] outcome=skipped reason=http_error\n',
    );
  });

  it('throttles per payment id with Redis SET NX EX', async () => {
    const set = mockRedis(
      vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
    );
    vi.mocked(writerPool.query).mockResolvedValue({ rows: [PAYMENT] } as any);
    fetchMock.mockResolvedValue(fwResponse());

    await runPendingPaymentVerificationFallback('user-a');
    await runPendingPaymentVerificationFallback('user-a');
    await flushBackgroundJobs();

    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(
      'payment_verify:pay-1',
      '1',
      'EX',
      10,
      'NX',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recordAndQueueFlutterwaveEvent).toHaveBeenCalledTimes(1);
  });

  it('skips Redis-unavailable checks without verifying', async () => {
    mockRedis(vi.fn().mockRejectedValue(new Error('offline')));
    vi.mocked(writerPool.query).mockResolvedValue({ rows: [PAYMENT] } as any);

    await runPendingPaymentVerificationFallback('user-a');
    await flushBackgroundJobs();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(
      '[Payment Verify Fallback] outcome=skipped reason=redis_unavailable\n',
    );
  });

  it('scopes the pending-payment query to the authenticated user', async () => {
    vi.mocked(writerPool.query).mockResolvedValue({ rows: [] } as any);

    await runPendingPaymentVerificationFallback('user-a');

    expect(writerPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(writerPool.query).mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(params).toEqual(['user-a', PAYMENT_VERIFY_MIN_AGE_SECONDS, 3, 'avue_']);
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("created_at <= NOW() - ($2::int * INTERVAL '1 second')");
    expect(sql).toContain('LEFT(provider_ref, 5) = $4');
    expect(sql).toContain("'NGN'::text AS currency");
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT $3');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips entirely when PAYMENT_SIMULATOR is true', async () => {
    (env as any).PAYMENT_SIMULATOR = true;

    await runPendingPaymentVerificationFallback('user-a');

    expect(writerPool.query).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
