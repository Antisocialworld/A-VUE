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
  /**
   * Required in simulator mode. Base URL (scheme + host[:port]) reachable by the client.
   * Must be derived from a validated request host or PUBLIC_API_URL; never from env.HOST.
   */
  simulatorBaseUrl?: string;
}

export interface CreatePaymentLinkResult {
  paymentLink: string;
  isSimulated: boolean;
}

export interface ResolveSimulatorBaseUrlInput {
  publicApiUrl?: string;
  protocol: string;
  hostHeader?: string | string[];
  forwardedHost?: string | string[];
  forwardedProto?: string | string[];
  trustProxy: boolean | number;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]?.trim();
  if (typeof value === 'string') return value.split(',')[0]?.trim();
  return undefined;
}

function isLoopbackOrUnspecifiedHost(host: string): boolean {
  const hostname = host.split(':', 1)[0]?.toLowerCase() || '';
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1' || hostname === '[::1]';
}

/**
 * Validates a simulator base URL host and returns a safe "protocol://host[:port]" origin.
 * Host must contain only letters, digits, dots, hyphens, and an optional :port.
 * Never emits 0.0.0.0, 127.0.0.1, localhost, or untrusted/malformed input.
 */
export function resolveSimulatorBaseUrl(input: ResolveSimulatorBaseUrlInput): string | null {
  const tryOrigin = (candidate: string | undefined, allowProtocolOverride = true): string | null => {
    if (!candidate) return null;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (url.username || url.password) return null;
      if (!url.host) return null;
      // letters, digits, dots, hyphens, optional :port only
      if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(url.host)) return null;
      if (isLoopbackOrUnspecifiedHost(url.host)) return null;
      if (!allowProtocolOverride && url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  };

  // 1) Explicit PUBLIC_API_URL (if set and valid)
  const fromPublic = tryOrigin(input.publicApiUrl);
  if (fromPublic) return fromPublic;

  // 2) Derive from request, honoring TRUST_PROXY/forwarded headers the same way the server does
  const trustProxy = input.trustProxy === true || (typeof input.trustProxy === 'number' && input.trustProxy > 0);
  const forwardedProto = firstHeaderValue(input.forwardedProto)?.toLowerCase();
  const forwardedHost = firstHeaderValue(input.forwardedHost);
  const hostHeader = firstHeaderValue(input.hostHeader);

  let protocol = (input.protocol || 'http').toLowerCase();
  if (trustProxy && (forwardedProto === 'http' || forwardedProto === 'https')) {
    protocol = forwardedProto;
  }
  if (protocol !== 'http' && protocol !== 'https') protocol = 'http';

  const host = trustProxy && forwardedHost ? forwardedHost : hostHeader;
  if (!host) return null;
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return null;
  if (isLoopbackOrUnspecifiedHost(host)) return null;

  return `${protocol}://${host}`;
}

/**
 * Computes whether Flutterwave is operating in test mode based on key prefix.
 * Test keys start with 'FLWSECK_TEST-'. Live keys start with 'FLWSECK-'.
 * Never logs, prints, or returns any secret key (Rule 02 / Task 3).
 */
export function isFlutterwaveTestMode(): boolean {
  if (env.PAYMENT_SIMULATOR) {
    return true;
  }
  const secretKey = env.FLUTTERWAVE_SECRET_KEY || '';
  if (!secretKey || secretKey.trim().length === 0) {
    return true; // Safe fallback when no key is set
  }
  return secretKey.startsWith('FLWSECK_TEST');
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
    const baseUrl = params.simulatorBaseUrl;
    if (!baseUrl) {
      throw new Error('SIMULATOR_BASE_URL_UNAVAILABLE');
    }
    const simLink = `${baseUrl}/dev/simulate-payment?tx_ref=${encodeURIComponent(params.txRef)}&amount=${params.amountKobo}`;
    return {
      paymentLink: simLink,
      isSimulated: true,
    };
  }

  // 2. Real Flutterwave Test Mode API Call
  const secretKey = env.FLUTTERWAVE_SECRET_KEY;
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
  // Reads only validated env; empty, unset, or whitespace-only returns false (Task 1 & Task 5)
  const secretHash = env.FLUTTERWAVE_SECRET_HASH;
  if (!secretHash || secretHash.trim().length === 0) {
    process.stderr.write('[Flutterwave Webhook Error] FLUTTERWAVE_SECRET_HASH not configured in env\n');
    return false;
  }

  const verifHashHeader = headers['verif-hash'];
  if (typeof verifHashHeader !== 'string' || verifHashHeader.trim().length === 0) {
    return false;
  }

  const headerBuf = Buffer.from(verifHashHeader, 'utf-8');
  const secretBuf = Buffer.from(secretHash, 'utf-8');

  // Prevent any empty buffer comparisons; empty header & empty secret must never compare equal
  if (headerBuf.length === 0 || secretBuf.length === 0 || headerBuf.length !== secretBuf.length) {
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
  const secretKey = env.FLUTTERWAVE_SECRET_KEY;
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
