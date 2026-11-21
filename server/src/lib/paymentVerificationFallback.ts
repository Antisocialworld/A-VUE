/**
 * A VUE pending-payment verification fallback.
 * Triggered from GET /tickets; all provider work runs in the background so the
 * tickets response and its speed are unchanged.
 */

import { env } from '../env.js';
import { runInBackground } from './background.js';
import { writerPool } from './db.js';
import { verifyTransactionWithFlutterwave } from './flutterwave.js';
import { recordAndQueueFlutterwaveEvent } from './flutterwaveEvents.js';
import { getRedisClient } from './redis.js';

export const PAYMENT_VERIFY_MIN_AGE_SECONDS = 10;

const PAYMENT_VERIFY_THROTTLE_TTL_SECONDS = 10;
const PAYMENT_VERIFY_TIMEOUT_MS = 5000;
const PENDING_PAYMENT_LIMIT = 3;
const FLUTTERWAVE_REF_PREFIX = 'avue_';
const THROTTLE_KEY_PREFIX = 'payment_verify:';

type FallbackReason =
  | 'redis_unavailable'
  | 'status_not_successful'
  | 'tx_ref_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'timeout'
  | 'http_error'
  | 'verify_error'
  | 'webhook_won'
  | 'fallback_error'
  | 'background_error';

export interface PendingPaymentForVerification {
  id: string;
  provider_ref: string;
  amount_kobo: number | string;
  currency: string;
}

function logFallback(reason: FallbackReason): void {
  process.stderr.write(
    `[Payment Verify Fallback] outcome=skipped reason=${reason}\n`,
  );
}

function reasonForVerifyError(err: any): FallbackReason {
  if (err?.name === 'AbortError' || err?.message === 'timeout') return 'timeout';
  if (
    typeof err?.message === 'string' &&
    err.message.startsWith('FLUTTERWAVE_VERIFY_HTTP_')
  ) {
    return 'http_error';
  }
  return 'verify_error';
}

async function acquireThrottle(paymentId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => {});
    }

    const result = await redis.set(
      `${THROTTLE_KEY_PREFIX}${paymentId}`,
      '1',
      'EX',
      PAYMENT_VERIFY_THROTTLE_TTL_SECONDS,
      'NX',
    );

    return result === 'OK';
  } catch {
    logFallback('redis_unavailable');
    return false;
  }
}

async function verifyWithHardTimeout(txRef: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, PAYMENT_VERIFY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      verifyTransactionWithFlutterwave(txRef, controller.signal),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function verifyAndRecordPendingPayment(
  payment: PendingPaymentForVerification,
): Promise<void> {
  try {
    const verified = await verifyWithHardTimeout(payment.provider_ref);

    if (verified.status !== 'successful') {
      logFallback('status_not_successful');
      return;
    }
    if (verified.txRef !== payment.provider_ref) {
      logFallback('tx_ref_mismatch');
      return;
    }
    if (Number(verified.amountKobo) !== Number(payment.amount_kobo)) {
      logFallback('amount_mismatch');
      return;
    }
    if (verified.currency !== payment.currency || payment.currency !== 'NGN') {
      logFallback('currency_mismatch');
      return;
    }

    const syntheticPayload = {
      event: 'charge.completed',
      data: {
        id: verified.id,
        tx_ref: verified.txRef,
        status: verified.status,
        amount: (verified.amountKobo / 100).toFixed(2),
        currency: verified.currency,
      },
    };

    const result = await recordAndQueueFlutterwaveEvent(syntheticPayload);
    if (!result.inserted) {
      logFallback('webhook_won');
    }
  } catch (err: any) {
    logFallback(reasonForVerifyError(err));
  }
}

export async function runPendingPaymentVerificationFallback(
  userId: string,
): Promise<void> {
  if (env.PAYMENT_SIMULATOR) return;

  try {
    const pendingRes = await writerPool.query(
      `SELECT id, provider_ref, amount_kobo, 'NGN'::text AS currency
       FROM payments
       WHERE user_id = $1
         AND status = 'pending'
         AND created_at <= NOW() - ($2::int * INTERVAL '1 second')
         AND provider_ref IS NOT NULL
         AND LEFT(provider_ref, 5) = $4
       ORDER BY created_at DESC
       LIMIT $3`,
      [
        userId,
        PAYMENT_VERIFY_MIN_AGE_SECONDS,
        PENDING_PAYMENT_LIMIT,
        FLUTTERWAVE_REF_PREFIX,
      ],
    );

    for (const row of pendingRes.rows) {
      if (typeof row.provider_ref !== 'string' || row.provider_ref.length === 0) {
        continue;
      }

      const payment: PendingPaymentForVerification = {
        id: row.id,
        provider_ref: row.provider_ref,
        amount_kobo: row.amount_kobo,
        currency: row.currency,
      };

      runInBackground('verify-fallback', async () => {
        if (!(await acquireThrottle(payment.id))) return;
        await verifyAndRecordPendingPayment(payment);
      });
    }
  } catch {
    logFallback('fallback_error');
  }
}
