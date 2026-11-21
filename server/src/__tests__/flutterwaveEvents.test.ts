import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db.js', () => ({ writerPool: { query: vi.fn() } }));
vi.mock('../lib/jobs.js', () => ({ processWebhookEvent: vi.fn() }));
vi.mock('../lib/flutterwave.js', () => ({
  verifyFlutterwaveSignature: vi.fn(() => true),
}));

import Fastify from 'fastify';
import { writerPool } from '../lib/db.js';
import { processWebhookEvent } from '../lib/jobs.js';
import {
  deriveFlutterwaveEventId,
  recordAndQueueFlutterwaveEvent,
} from '../lib/flutterwaveEvents.js';
import { webhookRoutes } from '../routes/webhooks.js';

const VERIFIED_PAYLOAD = {
  event: 'charge.completed',
  data: {
    id: 424242,
    tx_ref: 'avue_abc123',
    status: 'successful',
    amount: '100.00',
    currency: 'NGN',
  },
};

const WEBHOOK_PAYLOAD = {
  event: 'charge.completed',
  data: { ...VERIFIED_PAYLOAD.data },
};

async function flushBackgroundJobs() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function runOnceEach(first: any, second: any) {
  vi.mocked(writerPool.query)
    .mockResolvedValueOnce({ rows: [{ id: 'db-row' }] } as any)
    .mockResolvedValueOnce({ rows: [] } as any);

  await recordAndQueueFlutterwaveEvent(first);
  await recordAndQueueFlutterwaveEvent(second);
  await flushBackgroundJobs();

  expect(processWebhookEvent).toHaveBeenCalledTimes(1);
  const calls = vi.mocked(writerPool.query).mock.calls as unknown as Array<
    [string, any[]]
  >;
  expect(calls[0][1][0]).toBe(calls[1][1][0]);
  expect(calls[0][0]).toContain('ON CONFLICT (event_id) DO NOTHING');
  expect(calls[0][1][0]).toBe('424242');
}

beforeEach(() => {
  vi.mocked(writerPool.query).mockReset();
  vi.mocked(processWebhookEvent).mockReset();
  vi.mocked(processWebhookEvent).mockResolvedValue({ status: 'confirmed' } as any);
});

describe('Shared Flutterwave event recording', () => {
  it('derives the same event_id from verified data.id and real webhook data.id', () => {
    expect(deriveFlutterwaveEventId(VERIFIED_PAYLOAD)).toBe('424242');
    expect(deriveFlutterwaveEventId(WEBHOOK_PAYLOAD)).toBe('424242');
    expect(deriveFlutterwaveEventId(VERIFIED_PAYLOAD)).toBe(
      deriveFlutterwaveEventId(WEBHOOK_PAYLOAD),
    );
  });

  it('issues once for fallback-then-webhook', async () => {
    await runOnceEach(VERIFIED_PAYLOAD, WEBHOOK_PAYLOAD);
  });

  it('issues once for webhook-then-fallback', async () => {
    await runOnceEach(WEBHOOK_PAYLOAD, VERIFIED_PAYLOAD);
  });

  it('keeps the webhook duplicate response unchanged', async () => {
    vi.mocked(writerPool.query).mockResolvedValueOnce({ rows: [] } as any);
    const app = Fastify();
    await app.register(webhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/flutterwave',
      payload: WEBHOOK_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, deduplicated: true });
    await app.close();
  });

  it('keeps the webhook insert response unchanged', async () => {
    vi.mocked(writerPool.query).mockResolvedValueOnce({
      rows: [{ id: 'db-row' }],
    } as any);
    const app = Fastify();
    await app.register(webhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/flutterwave',
      payload: WEBHOOK_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    await app.close();
  });
});
