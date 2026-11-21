import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { PAYMENT_SIMULATOR: false },
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  verify: vi.fn(),
  nairaToKobo: vi.fn(),
  markSeatsSold: vi.fn(),
  releaseSeats: vi.fn(),
}));

vi.mock('../env.js', () => ({ env: mocks.env }));
vi.mock('../lib/db.js', () => ({ writerPool: { connect: mocks.connect } }));
vi.mock('../lib/flutterwave.js', () => ({
  nairaToKobo: mocks.nairaToKobo,
  verifyTransactionWithFlutterwave: mocks.verify,
}));
vi.mock('../lib/holds.js', () => ({
  markSeatsSold: mocks.markSeatsSold,
  releaseSeats: mocks.releaseSeats,
}));

import { processWebhookEvent } from '../lib/jobs.js';

const PAYMENT = {
  id: 'pay-1',
  user_id: 'user-1',
  amount_kobo: 500000,
  fee_kobo: 25000,
  status: 'pending',
  idempotency_key: 'idem-1',
  provider_ref: 'avue_ref',
};

function eventRow(eventId: string) {
  return {
    id: `row-${eventId}`,
    event_id: eventId,
    status: 'received',
    payload: {
      event: 'charge.completed',
      data: { id: 424242, tx_ref: 'avue_ref', status: 'successful', currency: 'NGN' },
    },
  };
}

function queueQueries(event: ReturnType<typeof eventRow>, payment: typeof PAYMENT) {
  mocks.query.mockImplementation(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized === 'BEGIN') return { rows: [] };
    if (normalized.includes('SELECT id, event_id, payload, status FROM webhook_events')) {
      return { rows: [event] };
    }
    if (normalized.includes('FROM payments p')) return { rows: [payment] };
    if (normalized.includes('SELECT response_body FROM idempotency_keys')) {
      return { rows: [{ response_body: { meta: { showtimeId: 'show-1', seatIds: ['seat-1'] } } }] };
    }
    if (normalized.startsWith('INSERT INTO bookings')) return { rows: [{ id: 'booking-1' }] };
    return { rows: [] };
  });
}

function allSql(): string {
  return mocks.query.mock.calls.map((call: any[]) => String(call[0])).join('\n');
}

describe('processWebhookEvent payment-status guard', () => {
  beforeEach(() => {
    mocks.env.PAYMENT_SIMULATOR = false;
    mocks.connect.mockReset().mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockReset();
    mocks.release.mockReset().mockResolvedValue(undefined);
    mocks.verify.mockReset().mockResolvedValue({
      status: 'successful',
      amountKobo: 500000,
      currency: 'NGN',
      txRef: 'avue_ref',
    });
    mocks.nairaToKobo.mockReset().mockImplementation((value: string) => Math.round(Number(value) * 100));
    mocks.markSeatsSold.mockReset().mockResolvedValue(undefined);
    mocks.releaseSeats.mockReset().mockResolvedValue(undefined);
  });

  it('ignores a second event with a different event_id for an already-successful payment', async () => {
    queueQueries(eventRow('evt-second'), { ...PAYMENT, status: 'successful' });

    const result = await processWebhookEvent('evt-second');

    expect(result).toEqual({ status: 'ignored', message: 'Payment already successful' });
    expect(mocks.verify).not.toHaveBeenCalled();

    const sql = allSql();
    expect(sql).toContain("UPDATE webhook_events SET status = 'ignored'");
    expect(sql).toContain('COMMIT');
    expect(sql).not.toMatch(/INSERT INTO (bookings|tickets|ledger|refunds)/);
    expect(sql).not.toContain("UPDATE payments SET status = 'refunded'");
    expect(sql).not.toContain("UPDATE payments SET status = 'successful'");
    expect(sql).not.toContain('SELECT response_body FROM idempotency_keys');
    expect(mocks.markSeatsSold).not.toHaveBeenCalled();
    expect(mocks.releaseSeats).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('keeps the normal first-event confirmation path unchanged', async () => {
    queueQueries(eventRow('evt-first'), PAYMENT);

    const result = await processWebhookEvent('evt-first');

    expect(result).toEqual({
      status: 'confirmed',
      bookingIds: ['booking-1'],
      message: 'Booking confirmed and tickets issued successfully',
    });
    expect(mocks.verify).toHaveBeenCalledTimes(1);

    const sql = allSql();
    expect(sql).toContain('INSERT INTO bookings');
    expect(sql).toContain('INSERT INTO tickets');
    expect(sql).toContain('INSERT INTO ledger');
    expect(sql).toContain('UPDATE webhook_events SET status = \'processed\'');
    expect(mocks.markSeatsSold).toHaveBeenCalledWith('show-1', ['seat-1'], 'user-1');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('places the guard after the payment fetch and before verification or side effects', () => {
    const jobsSrc = fs.readFileSync(path.resolve(__dirname, '../lib/jobs.ts'), 'utf-8');
    const fetchIdx = jobsSrc.indexOf('const payment = paymentRes.rows[0];');
    const guardIdx = jobsSrc.indexOf("if (payment.status === 'successful')");
    const verifyIdx = jobsSrc.indexOf('verifyTransactionWithFlutterwave(transactionId)');

    expect(fetchIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(fetchIdx);
    expect(guardIdx).toBeLessThan(verifyIdx);
    for (const marker of [
      'INSERT INTO bookings',
      'INSERT INTO tickets',
      'INSERT INTO ledger',
      'INSERT INTO refunds',
    ]) {
      expect(guardIdx).toBeLessThan(jobsSrc.indexOf(marker));
    }
    expect(jobsSrc).toContain(
      "return { status: 'ignored', message: 'Payment already successful' };",
    );
  });
});
