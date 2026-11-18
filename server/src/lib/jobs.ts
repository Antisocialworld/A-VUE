/**
 * A VUE Background Jobs & Transaction Ledger Processing
 * Implements webhook processing, booking confirmation, late-webhook race auto-refunds,
 * cancelled showtime refunds, and append-only ledger entries.
 * (Rule 03 / Rule 04 / Tasks 7 & 9)
 */

import crypto from 'node:crypto';
import { env } from '../env.js';
import { writerPool } from './db.js';
import { nairaToKobo, verifyTransactionWithFlutterwave } from './flutterwave.js';
import { markSeatsSold, releaseSeats } from './holds.js';

export interface TransactionDetails {
  status: string;
  amountKobo: number;
  currency: string;
  txRef: string;
}

export interface ExpectedPaymentDetails {
  amountKobo: number;
  txRef: string;
}

export interface MismatchCheckResult {
  valid: boolean;
  mismatchType?: 'status' | 'amount' | 'currency' | 'tx_ref';
  reason?: string;
}

/**
 * Validates verified transaction details against expected payment record (Task 2).
 * Verifies status === 'successful', exact integer kobo amount, currency === 'NGN', and txRef.
 */
export function checkTransactionMismatch(
  actual: TransactionDetails,
  expected: ExpectedPaymentDetails
): MismatchCheckResult {
  if (actual.status !== 'successful') {
    return {
      valid: false,
      mismatchType: 'status',
      reason: `status mismatch: expected 'successful', got '${actual.status}'`,
    };
  }
  if (actual.amountKobo !== expected.amountKobo) {
    return {
      valid: false,
      mismatchType: 'amount',
      reason: `amount mismatch: expected ${expected.amountKobo} kobo, got ${actual.amountKobo} kobo`,
    };
  }
  if (actual.currency !== 'NGN') {
    return {
      valid: false,
      mismatchType: 'currency',
      reason: `currency mismatch: expected 'NGN', got '${actual.currency}'`,
    };
  }
  if (actual.txRef !== expected.txRef) {
    return {
      valid: false,
      mismatchType: 'tx_ref',
      reason: `tx_ref mismatch: expected '${expected.txRef}', got '${actual.txRef}'`,
    };
  }
  return { valid: true };
}

export interface ProcessWebhookResult {
  status: 'confirmed' | 'refunded_late_race' | 'failed' | 'ignored' | 'flagged';
  bookingIds?: string[];
  refundId?: string;
  message?: string;
  paymentId?: string;
  reason?: string;
  mismatchType?: string;
}

/**
 * Processes a single received Flutterwave webhook event.
 * Confirms bookings or auto-refunds if hold expired and seat was taken by another user.
 */
export async function processWebhookEvent(eventId: string): Promise<ProcessWebhookResult> {
  const pool = writerPool;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch event from webhook_events table
    const eventRes = await client.query(
      `SELECT id, event_id, payload, status FROM webhook_events WHERE event_id = $1 FOR UPDATE`,
      [eventId]
    );

    if (eventRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'ignored', message: 'Event not found' };
    }

    const event = eventRes.rows[0];
    if (event.status === 'processed') {
      await client.query('ROLLBACK');
      return { status: 'ignored', message: 'Event already processed' };
    }

    const payload = event.payload;
    const txRef = payload?.data?.tx_ref;
    const fwStatus = payload?.data?.status;

    if (!txRef) {
      await client.query(
        `UPDATE webhook_events SET status = 'ignored' WHERE id = $1`,
        [event.id]
      );
      await client.query('COMMIT');
      return { status: 'ignored', message: 'No tx_ref in payload' };
    }

    // 2. Fetch payment record by provider_ref (tx_ref)
    const paymentRes = await client.query(
      `SELECT p.id, p.user_id, p.amount_kobo, p.fee_kobo, p.status, p.idempotency_key,
              u.email
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.provider_ref = $1 FOR UPDATE`,
      [txRef]
    );

    if (paymentRes.rows.length === 0) {
      await client.query(
        `UPDATE webhook_events SET status = 'ignored' WHERE id = $1`,
        [event.id]
      );
      await client.query('COMMIT');
      return { status: 'ignored', message: 'Matching payment record not found' };
    }

    const payment = paymentRes.rows[0];

    // Verification & Mismatch check (Task 2):
    // Status, amount, currency, or tx_ref mismatch must NOT insert a ledger row of a type the CHECK forbids.
    // Instead mark the payment 'flagged', create no booking, confirm no seats, let hold expire naturally,
    // log ONLY payment id and reason (no secrets, no personal data), and return 200.
    let verifiedDetails: TransactionDetails;

    if (!env.PAYMENT_SIMULATOR) {
      try {
        const transactionId = payload?.data?.id || txRef;
        const verified = await verifyTransactionWithFlutterwave(transactionId);
        verifiedDetails = {
          status: verified.status,
          amountKobo: verified.amountKobo,
          currency: verified.currency,
          txRef: verified.txRef,
        };
      } catch (err: any) {
        process.stderr.write(
          `[Payment Verify Error] Payment ID ${payment.id}: Verification re-query failed: ${err.message}\n`
        );
        await client.query(
          `UPDATE payments SET status = 'flagged' WHERE id = $1`,
          [payment.id]
        );
        await client.query(
          `UPDATE webhook_events SET status = 'processed' WHERE id = $1`,
          [event.id]
        );
        await client.query('COMMIT');
        return { status: 'flagged', paymentId: payment.id, message: 'Payment verification failed' };
      }
    } else {
      verifiedDetails = {
        status: fwStatus || 'successful',
        amountKobo: payload?.data?.amount ? nairaToKobo(payload.data.amount) : Number(payment.amount_kobo),
        currency: payload?.data?.currency || 'NGN',
        txRef: txRef,
      };
    }

    const mismatch = checkTransactionMismatch(verifiedDetails, {
      amountKobo: Number(payment.amount_kobo),
      txRef: payment.idempotency_key || txRef,
    });

    if (!mismatch.valid) {
      // Log ONLY payment id and reason (no secrets, no personal data) (Task 2)
      process.stderr.write(
        `[Payment Discrepancy Flagged] Payment ID ${payment.id}: ${mismatch.reason}\n`
      );

      // Mark payment 'flagged' (do NOT mark possibly-paid payment 'failed')
      await client.query(
        `UPDATE payments SET status = 'flagged' WHERE id = $1`,
        [payment.id]
      );

      // Create no booking, confirm no seats, let hold expire naturally, insert NO ledger rows
      await client.query(
        `UPDATE webhook_events SET status = 'processed' WHERE id = $1`,
        [event.id]
      );
      await client.query('COMMIT');

      return {
        status: 'flagged',
        paymentId: payment.id,
        reason: mismatch.reason,
        mismatchType: mismatch.mismatchType,
        message: 'Payment verification discrepancy flagged. No booking created.',
      };
    }

    // 3. Extract seatIds and showtimeId from payment idempotency key or metadata
    // In checkout, we stored showtimeId and seatIds in metadata / idempotency_keys
    const idemRes = await client.query(
      `SELECT response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2`,
      [payment.idempotency_key, payment.user_id]
    );

    const checkoutMeta = idemRes.rows[0]?.response_body?.meta || payload?.data?.meta || {};
    const showtimeId = checkoutMeta.showtimeId;
    const seatIds: string[] = checkoutMeta.seatIds || [];

    if (!showtimeId || seatIds.length === 0) {
      await client.query(
        `UPDATE payments SET status = 'successful' WHERE id = $1`,
        [payment.id]
      );
      await client.query(
        `UPDATE webhook_events SET status = 'processed' WHERE id = $1`,
        [event.id]
      );
      await client.query('COMMIT');
      return { status: 'confirmed', message: 'Payment marked successful without seats' };
    }

    // 4. Attempt to insert rows into bookings table
    // Protected by UNIQUE(showtime_id, seat_id) safety net
    const bookingIds: string[] = [];
    let seatContentionLost = false;

    for (const seatId of seatIds) {
      try {
        const bookingRes = await client.query(
          `INSERT INTO bookings (user_id, showtime_id, seat_id, status)
           VALUES ($1, $2, $3, 'confirmed')
           RETURNING id`,
          [payment.user_id, showtimeId, seatId]
        );
        bookingIds.push(bookingRes.rows[0].id);
      } catch (err: any) {
        if (err?.code === '23505') {
          // Unique constraint violation (uq_bookings_showtime_seat)
          // Another user already booked this seat because the original hold expired!
          seatContentionLost = true;
          break;
        } else {
          throw err;
        }
      }
    }

    // ============================================================================
    // CASE A: LATE WEBHOOK RACE CONDITION (Lost seat contention)
    // ============================================================================
    if (seatContentionLost) {
      // Roll back any partial bookings inserted in this loop
      if (bookingIds.length > 0) {
        await client.query(
          `DELETE FROM bookings WHERE id = ANY($1::uuid[])`,
          [bookingIds]
        );
      }

      // Mark payment as refunded
      await client.query(
        `UPDATE payments SET status = 'refunded' WHERE id = $1`,
        [payment.id]
      );

      // Create unique refund record
      const refundRef = `refund_late_race_${payment.id}`;
      const refundRes = await client.query(
        `INSERT INTO refunds (booking_id, payment_id, user_id, amount_kobo, reason, status, refund_ref)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6)
         ON CONFLICT (refund_ref) DO UPDATE SET status = 'completed'
         RETURNING id`,
        [
          '00000000-0000-0000-0000-000000000000', // Sentinel null booking id
          payment.id,
          payment.user_id,
          payment.amount_kobo,
          'Late webhook: seat contention lost after hold expiry',
          refundRef,
        ]
      );

      // Append refund movement to financial ledger
      await client.query(
        `INSERT INTO ledger (entry_type, amount_kobo, user_id, payment_id, reference, description)
         VALUES ('refund_out', $1, $2, $3, $4, $5)`,
        [
          payment.amount_kobo,
          payment.user_id,
          payment.id,
          refundRef,
          'Auto-refund: late webhook lost seat contention',
        ]
      );

      await client.query(
        `UPDATE webhook_events SET status = 'processed' WHERE id = $1`,
        [event.id]
      );

      await client.query('COMMIT');

      return {
        status: 'refunded_late_race',
        refundId: refundRes.rows[0].id,
        message: 'Seats were taken by another user after hold expiry. Payment auto-refunded to ledger.',
      };
    }

    // ============================================================================
    // CASE B: NORMAL CONFIRMATION (Seat acquired cleanly)
    // ============================================================================
    // Update payment record
    await client.query(
      `UPDATE payments SET status = 'successful', booking_id = $1 WHERE id = $2`,
      [bookingIds[0], payment.id]
    );

    // Generate Tickets with random >=128-bit QR references (Rule 02 / Task 8)
    for (let i = 0; i < bookingIds.length; i++) {
      const bId = bookingIds[i];
      // 256-bit random opaque reference string from crypto.randomBytes
      const qrReference = crypto.randomBytes(32).toString('hex');
      // Store ONLY the SHA-256 hash in database
      const qrHash = crypto.createHash('sha256').update(qrReference).digest('hex');

      await client.query(
        `INSERT INTO tickets (booking_id, user_id, qr_hash, status)
         VALUES ($1, $2, $3, 'active')`,
        [bId, payment.user_id, qrHash]
      );
    }

    // Append money in to append-only financial ledger
    const ticketAmountKobo = BigInt(payment.amount_kobo) - BigInt(payment.fee_kobo);

    await client.query(
      `INSERT INTO ledger (entry_type, amount_kobo, user_id, booking_id, payment_id, reference, description)
       VALUES ('payment_in', $1, $2, $3, $4, $5, 'Ticket sale payment')`,
      [ticketAmountKobo, payment.user_id, bookingIds[0], payment.id, txRef]
    );

    if (payment.fee_kobo > 0) {
      await client.query(
        `INSERT INTO ledger (entry_type, amount_kobo, user_id, booking_id, payment_id, reference, description)
         VALUES ('fee_in', $1, $2, $3, $4, $5, 'Service booking fee')`,
        [payment.fee_kobo, payment.user_id, bookingIds[0], payment.id, `${txRef}_fee`]
      );
    }

    await client.query(
      `UPDATE webhook_events SET status = 'processed' WHERE id = $1`,
      [event.id]
    );

    await client.query('COMMIT');

    // 5. Update Redis state: write permanent sold marker and clear holds
    await markSeatsSold(showtimeId, seatIds, payment.user_id);

    return {
      status: 'confirmed',
      bookingIds,
      message: 'Booking confirmed and tickets issued successfully',
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    process.stderr.write(`[Jobs Error] Webhook processing failed: ${err.message}\n`);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Processes all received unprocessed webhook events (for cron or batch runs).
 */
export async function processPendingWebhookEvents(): Promise<number> {
  const pool = writerPool;
  const res = await pool.query(
    `SELECT event_id FROM webhook_events WHERE status = 'received' ORDER BY created_at ASC LIMIT 50`
  );

  let processedCount = 0;
  for (const row of res.rows) {
    try {
      await processWebhookEvent(row.event_id);
      processedCount++;
    } catch (err: any) {
      process.stderr.write(`[Jobs Warning] Error processing event ${row.event_id}: ${err.message}\n`);
    }
  }

  return processedCount;
}

/**
 * Cancels a showtime and refunds every paid booking through an idempotent ledger transaction.
 * (Rule 04 / Task 9)
 */
export async function cancelShowtimeAndRefund(showtimeId: string): Promise<{
  refundedCount: number;
  totalKoboRefunded: bigint;
}> {
  const pool = writerPool;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Mark showtime as cancelled
    await client.query(
      `UPDATE showtimes SET cancelled_at = NOW() WHERE id = $1`,
      [showtimeId]
    );

    // 2. Fetch all confirmed bookings for this showtime
    const bookingsRes = await client.query(
      `SELECT b.id as booking_id, b.user_id, b.seat_id, p.id as payment_id, p.amount_kobo
       FROM bookings b
       JOIN payments p ON p.booking_id = b.id OR (p.user_id = b.user_id AND p.status = 'successful')
       WHERE b.showtime_id = $1 AND b.status = 'confirmed'
       FOR UPDATE`,
      [showtimeId]
    );

    let refundedCount = 0;
    let totalKoboRefunded = 0n;
    const seatIdsToRelease: string[] = [];

    for (const row of bookingsRes.rows) {
      const refundRef = `refund_cancel_showtime_${row.booking_id}`;

      // Check if already refunded (idempotent guard)
      const existingRefund = await client.query(
        `SELECT id FROM refunds WHERE refund_ref = $1`,
        [refundRef]
      );

      if (existingRefund.rows.length === 0) {
        // Mark booking cancelled
        await client.query(
          `UPDATE bookings SET status = 'cancelled' WHERE id = $1`,
          [row.booking_id]
        );

        // Mark payment refunded
        await client.query(
          `UPDATE payments SET status = 'refunded' WHERE id = $1`,
          [row.payment_id]
        );

        // Cancel ticket
        await client.query(
          `UPDATE tickets SET status = 'cancelled' WHERE booking_id = $1`,
          [row.booking_id]
        );

        // Insert refund record
        await client.query(
          `INSERT INTO refunds (booking_id, payment_id, user_id, amount_kobo, reason, status, refund_ref)
           VALUES ($1, $2, $3, $4, 'Showtime cancelled by cinema', 'completed', $5)`,
          [row.booking_id, row.payment_id, row.user_id, row.amount_kobo, refundRef]
        );

        // Append to immutable ledger
        await client.query(
          `INSERT INTO ledger (entry_type, amount_kobo, user_id, booking_id, payment_id, reference, description)
           VALUES ('refund_out', $1, $2, $3, $4, $5, 'Showtime cancellation auto-refund')`,
          [row.amount_kobo, row.user_id, row.booking_id, row.payment_id, refundRef]
        );

        refundedCount++;
        totalKoboRefunded += BigInt(row.amount_kobo);
        seatIdsToRelease.push(row.seat_id);
      }
    }

    await client.query('COMMIT');

    // Release Redis hold/sold markers
    if (seatIdsToRelease.length > 0) {
      await releaseSeats(showtimeId, seatIdsToRelease, 'system').catch(() => { });
    }

    return {
      refundedCount,
      totalKoboRefunded,
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    process.stderr.write(`[CancelShowtime Error] Failed to cancel and refund showtime: ${err.message}\n`);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes stale, unbooked on-demand showtimes in one bounded statement.
 *
 * Safety rules:
 * - Only `source = 'on_demand'` rows can be deleted; seeded showtimes are never touched.
 * - Any showtime that appears in `bookings` is kept, so ticket/payment/refund history survives.
 * - Only showtimes that began more than 24 hours ago are considered stale.
 * - `LIMIT $1` + `SKIP LOCKED` keeps each cron run short and concurrency-safe.
 * - One DELETE statement, so a partial batch can never be half-applied.
 */
export async function purgeStaleOnDemandShowtimes(batchSize = 100): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('INVALID_BATCH_SIZE');
  }

  const pool = writerPool;
  const result = await pool.query(
    `WITH stale AS (
       SELECT s.id
       FROM showtimes s
       WHERE s.source = 'on_demand'
         AND s.starts_at < NOW() - INTERVAL '24 hours'
         AND NOT EXISTS (
           SELECT 1
           FROM bookings b
           WHERE b.showtime_id = s.id
         )
       ORDER BY s.starts_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM showtimes s
     USING stale
     WHERE s.id = stale.id
     RETURNING s.id`,
    [batchSize],
  );

  return result.rowCount ?? result.rows.length;
}

