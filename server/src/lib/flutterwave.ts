/**
 * A VUE Flutterwave Payment Integration Module
 * Official Flutterwave v3 documentation: flutterwavedoc.readme.io/reference/webhook
 * Webhook signature scheme: verif-hash header plain secret-hash compare via crypto.timingSafeEqual.
 * (Rule 02 / Rule 04 / Task 3)
 */

import crypto from 'node:crypto';
import { env } from '../env.js';

export interface CreatePaymentLinkParams {
  paymentId: string;
  txRef: string;
  amountKobo: number;
  userEmail: string;
  movieTitle?: string;
  redirectUrl?: string;
}

export interface CreatePaymentLinkResult {
  paymentLink: string;
  isSimulated: boolean;
}

export interface FlutterwaveVerifiedTransaction {
  status: string; // 'successful'
  amountKobo: number; // Converted from Naira to kobo via integer arithmetic
  currency: string;
  txRef: string;
  id: number;
}

/**
 * Converts major currency unit (Naira) to integer kobo using integer arithmetic only.
 * Avoids floating-point rounding errors (e.g. 110.25 -> 11025).
 */
export function nairaToKobo(amount: string | number): number {
  const str = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  const [wholePart, rawFracPart = '00'] = str.split('.');
  const whole = BigInt(wholePart || '0');
  const fracStr = (rawFracPart + '00').slice(0, 2);
  const frac = BigInt(fracStr);
  const total = whole * 100n + frac;
  return Number(total);
}

/**
 * Creates a Flutterwave hosted payment link or simulated payment link.
 * Never trust client prices: amountKobo is computed 100% on the server.
 */
export async function createFlutterwavePaymentLink(
  params: CreatePaymentLinkParams
): Promise<CreatePaymentLinkResult> {
  // 1. Payment Simulator Mode (Development & Test only - strictly refused in production by env.ts)
  if (env.PAYMENT_SIMULATOR) {
    const simLink = `http://${env.HOST}:${env.PORT}/dev/simulate-payment?tx_ref=${encodeURIComponent(params.txRef)}&amount=${params.amountKobo}`;
    return {
      paymentLink: simLink,
      isSimulated: true,
    };
  }

  // 2. Real Flutterwave Test Mode API Call
  const secretKey = env.FLUTTERWAVE_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('FLUTTERWAVE_SECRET_KEY_MISSING');
  }

  const amountNaira = (params.amountKobo / 100).toFixed(2);
  const redirectUrl =
    params.redirectUrl || `http://${env.HOST}:${env.PORT}/payments/callback?tx_ref=${params.txRef}`;

  const requestBody = {
    tx_ref: params.txRef,
    amount: amountNaira,
    currency: 'NGN',
    redirect_url: redirectUrl,
    customer: {
      email: params.userEmail,
    },
    customizations: {
      title: 'A VUE Cinema Tickets',
      description: params.movieTitle
        ? `Tickets for ${params.movieTitle}`
        : 'Cinema ticket booking',
    },
  };

  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    process.stderr.write(`[Flutterwave Error] API responded with ${response.status}: ${errorText}\n`);
    throw new Error(`FLUTTERWAVE_API_ERROR_${response.status}`);
  }

  const data = (await response.json()) as any;
  const link = data?.data?.link;
  if (!link) {
    throw new Error('FLUTTERWAVE_LINK_MISSING');
  }

  return {
    paymentLink: link,
    isSimulated: false,
  };
}

/**
 * Verifies incoming Flutterwave webhook signature using constant-time comparison.
 * Official Flutterwave v3 specification:
 * Header 'verif-hash' carries the configured secret hash.
 * Compared to FLUTTERWAVE_SECRET_HASH with crypto.timingSafeEqual (lengths checked first).
 * No HMAC used (Task 3a).
 */
export function verifyFlutterwaveSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const secretHash = env.FLUTTERWAVE_SECRET_HASH || process.env.FLUTTERWAVE_SECRET_HASH;
  if (!secretHash || secretHash.trim().length === 0) {
    process.stderr.write('[Flutterwave Webhook Error] FLUTTERWAVE_SECRET_HASH not configured in env\n');
    return false;
  }

  const verifHashHeader = headers['verif-hash'];
  if (typeof verifHashHeader !== 'string' || verifHashHeader.length === 0) {
    return false;
  }

  const headerBuf = Buffer.from(verifHashHeader, 'utf-8');
  const secretBuf = Buffer.from(secretHash, 'utf-8');

  // Length check before constant-time comparison
  if (headerBuf.length !== secretBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(headerBuf, secretBuf);
}

/**
 * Re-queries Flutterwave Verify transaction endpoint before confirming booking (Task 3b).
 * Requires:
 * - status === 'successful'
 * - amount equals stored amount (converted via integer arithmetic)
 * - currency matches 'NGN'
 * - tx_ref matches stored record
 */
export async function verifyTransactionWithFlutterwave(
  transactionIdOrRef: string | number
): Promise<FlutterwaveVerifiedTransaction> {
  const secretKey = env.FLUTTERWAVE_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('FLUTTERWAVE_SECRET_KEY_MISSING');
  }

  const url =
    typeof transactionIdOrRef === 'number' || /^\d+$/.test(String(transactionIdOrRef))
      ? `https://api.flutterwave.com/v3/transactions/${transactionIdOrRef}/verify`
      : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(String(transactionIdOrRef))}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`FLUTTERWAVE_VERIFY_HTTP_${response.status}`);
  }

  const json = (await response.json()) as any;
  if (json?.status !== 'success' || !json?.data) {
    throw new Error('FLUTTERWAVE_VERIFY_FAILED');
  }

  const data = json.data;
  const amountKobo = nairaToKobo(data.amount);

  return {
    status: data.status,
    amountKobo,
    currency: data.currency,
    txRef: data.tx_ref,
    id: data.id,
  };
}
