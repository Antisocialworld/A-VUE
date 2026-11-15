import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { writerPool } from '../lib/db.js';
import { createFlutterwavePaymentLink, isFlutterwaveTestMode } from '../lib/flutterwave.js';
import { verifyUserHolds } from '../lib/holds.js';
import { processWebhookEvent } from '../lib/jobs.js';
import { checkoutRateLimit } from '../lib/rateLimit.js';
import { getSessionUser, UnauthorizedError } from '../lib/session.js';
import { checkoutBodySchema } from '../schemas/cinema.js';

export async function checkoutRoutes(fastify: FastifyInstance) {
  /**
   * GET /checkout/config
   * Minimal public config endpoint returning testMode boolean.
   * Safe: returns only boolean flag, never credentials or keys (Rule 02 / Task 3).
   */
  fastify.get('/checkout/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      testMode: isFlutterwaveTestMode(),
    });
  });

  /**
   * POST /checkout
   * Initiates payment for held seats with mandatory Idempotency-Key.
   * Computes price and service fee (SERVICE_FEE_BPS) on server.
   * Rate limited per user and per IP.
   */
  fastify.post('/checkout', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const allowed = await checkoutRateLimit(request, reply, user.id);
    if (!allowed) return;

    // 1. Mandatory Idempotency-Key Header
    const idempotencyKey = request.headers['idempotency-key'] as string;
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header is required for checkout.',
          requestId: request.id,
        },
      });
    }

    const parsed = checkoutBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid checkout request payload.',
          requestId: request.id,
        },
      });
    }

    const { showtimeId, seatIds } = parsed.data;
    const pool = writerPool;

    // 2. Check Idempotency in DB (same key returns same result)
    const existingPaymentRes = await pool.query(
      `SELECT id, provider_ref, amount_kobo, fee_kobo, status FROM payments
       WHERE user_id = $1 AND idempotency_key = $2`,
      [user.id, idempotencyKey]
    );

    if (existingPaymentRes.rows.length > 0) {
      const existing = existingPaymentRes.rows[0];
      const linkRes = await createFlutterwavePaymentLink({
        paymentId: existing.id,
        txRef: existing.provider_ref,
        amountKobo: Number(existing.amount_kobo),
        userEmail: user.email,
      });

      return reply.status(200).send({
        paymentId: existing.id,
        txRef: existing.provider_ref,
        amountKobo: Number(existing.amount_kobo),
        feeKobo: Number(existing.fee_kobo),
        currency: 'NGN',
        paymentLink: linkRes.paymentLink,
        isSimulated: linkRes.isSimulated,
        testMode: isFlutterwaveTestMode(),
      });
    }

    // 3. Verify user still holds all requested seats
    const holdsValid = await verifyUserHolds(showtimeId, seatIds, user.id);
    if (!holdsValid) {
      return reply.status(409).send({
        error: {
          code: 'HOLDS_EXPIRED',
          message: 'One or more seat holds have expired. Please reselect your seats.',
          requestId: request.id,
        },
      });
    }

    // 4. Compute price and service fee on server (Never trust client price)
    const showtimeRes = await pool.query(
      `SELECT price_kobo, movie_id FROM showtimes WHERE id = $1 AND cancelled_at IS NULL`,
      [showtimeId]
    );

    if (showtimeRes.rows.length === 0) {
      return reply.status(404).send({
        error: {
          code: 'SHOWTIME_NOT_FOUND',
          message: 'Showtime not found or has been cancelled.',
          requestId: request.id,
        },
      });
    }

    const pricePerSeatKobo = Number(showtimeRes.rows[0].price_kobo);
    const basePriceKobo = pricePerSeatKobo * seatIds.length;
    // SERVICE_FEE_BPS default 500 = 5.00%
    const feeKobo = Math.round((basePriceKobo * env.SERVICE_FEE_BPS) / 10000);
    const totalAmountKobo = basePriceKobo + feeKobo;

    // 5. Create pending payment record
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const paymentInsertRes = await client.query(
        `INSERT INTO payments (user_id, amount_kobo, fee_kobo, status, idempotency_key, provider_ref)
         VALUES ($1, $2, $3, 'pending', $4, $5)
         RETURNING id`,
        [user.id, totalAmountKobo, feeKobo, idempotencyKey, 'pending_ref']
      );

      const paymentId = paymentInsertRes.rows[0].id;
      const txRef = `avue_${paymentId.replace(/-/g, '')}`;

      await client.query(
        `UPDATE payments SET provider_ref = $1 WHERE id = $2`,
        [txRef, paymentId]
      );

      // Record in idempotency_keys table with 24h expiry
      const expiresAt = new Date(Date.now() + env.IDEMPOTENCY_TTL_HOURS * 3600 * 1000);
      await client.query(
        `INSERT INTO idempotency_keys (user_id, route, key, response_status, response_body, expires_at)
         VALUES ($1, '/checkout', $2, 200, $3, $4)
         ON CONFLICT (user_id, route, key) DO NOTHING`,
        [
          user.id,
          idempotencyKey,
          JSON.stringify({
            paymentId,
            txRef,
            amountKobo: totalAmountKobo,
            feeKobo,
            meta: { showtimeId, seatIds },
          }),
          expiresAt,
        ]
      );

      await client.query('COMMIT');

      // 6. Generate Flutterwave hosted checkout link or simulated link
      const linkResult = await createFlutterwavePaymentLink({
        paymentId,
        txRef,
        amountKobo: totalAmountKobo,
        userEmail: user.email,
        movieTitle: 'A VUE Cinema Tickets',
      });

      return reply.status(200).send({
        paymentId,
        txRef,
        amountKobo: totalAmountKobo,
        feeKobo,
        currency: 'NGN',
        paymentLink: linkResult.paymentLink,
        isSimulated: linkResult.isSimulated,
        testMode: isFlutterwaveTestMode(),
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      process.stderr.write(`[Checkout Error] Failed to create payment: ${err.message}\n`);
      return reply.status(500).send({
        error: {
          code: 'CHECKOUT_FAILED',
          message: 'Unable to initiate checkout. Please try again.',
          requestId: request.id,
        },
      });
    } finally {
      client.release();
    }
  });

  /**
   * GET /dev/simulate-payment
   * Simulator callback endpoint to simulate successful payment in development/test.
   * Strictly disabled in production.
   */
  fastify.get('/dev/simulate-payment', async (request: FastifyRequest, reply: FastifyReply) => {
    if (env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Simulator forbidden in production' });
    }

    const { tx_ref } = request.query as { tx_ref?: string };
    if (!tx_ref) {
      return reply.status(400).send({ error: 'Missing tx_ref' });
    }

    const pool = writerPool;
    const paymentRes = await pool.query(
      `SELECT id, amount_kobo FROM payments WHERE provider_ref = $1`,
      [tx_ref]
    );

    if (paymentRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];

    // Synthesize webhook event
    const eventId = `sim_evt_${Date.now()}`;
    await pool.query(
      `INSERT INTO webhook_events (provider, event_id, event_type, payload, status)
       VALUES ('flutterwave_sim', $1, 'charge.completed', $2, 'received')
       ON CONFLICT (event_id) DO NOTHING`,
      [
        eventId,
        JSON.stringify({
          data: {
            tx_ref,
            status: 'successful',
            amount: Number(payment.amount_kobo) / 100,
          },
        }),
      ]
    );

    // Process event immediately
    const procResult = await processWebhookEvent(eventId);

    return reply.status(200).send({
      simulated: true,
      txRef: tx_ref,
      result: procResult,
    });
  });
}

