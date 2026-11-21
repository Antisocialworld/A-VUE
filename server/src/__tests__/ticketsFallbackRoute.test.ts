import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/paymentVerificationFallback.js', () => ({
  runPendingPaymentVerificationFallback: vi.fn(() => new Promise<void>(() => {})),
}));
vi.mock('../lib/db.js', () => ({ writerPool: { query: vi.fn() } }));
vi.mock('../lib/session.js', () => ({
  getSessionUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock('../env.js', () => ({ isAdmin: vi.fn() }));
vi.mock('../lib/tmdb.js', () => ({ getMovieDetails: vi.fn() }));

import Fastify from 'fastify';
import { writerPool } from '../lib/db.js';
import { getSessionUser } from '../lib/session.js';
import { runPendingPaymentVerificationFallback } from '../lib/paymentVerificationFallback.js';
import { ticketRoutes } from '../routes/tickets.js';

let app: any;

afterEach(async () => {
  if (app) await app.close();
  vi.clearAllMocks();
});

describe('GET /tickets with verify fallback', () => {
  it('returns tickets without waiting for the background verification', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'user-a',
      email: 'owner@example.com',
    } as any);
    vi.mocked(writerPool.query).mockResolvedValue({ rows: [] } as any);

    app = Fastify();
    await app.register(ticketRoutes);

    const res = await app.inject({ method: 'GET', url: '/tickets' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tickets: [] });
    expect(runPendingPaymentVerificationFallback).toHaveBeenCalledWith('user-a');
  });
});
