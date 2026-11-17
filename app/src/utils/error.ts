import { STRINGS } from '../constants/strings';

export type ErrorKind = 'no_connection' | 'server_busy' | 'generic';

export interface ErrorCopy {
  title: string;
  body: string;
  kind: ErrorKind;
  retryAfter?: number;
}

/**
 * Maps an API client error or unknown caught exception to user-friendly copy.
 * Raw technical messages, stack traces, and internal server error strings
 * are NEVER displayed to the user.
 */
export function getErrorCopy(error: unknown): ErrorCopy {
  if (!error) {
    return {
      title: STRINGS.errors.genericTitle,
      body: STRINGS.errors.genericBody,
      kind: 'generic',
    };
  }

  const err = error as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
    retryAfter?: number | string;
  };

  const status = typeof err.status === 'number' ? err.status : undefined;
  const code = typeof err.code === 'string' ? err.code : undefined;
  const name = typeof err.name === 'string' ? err.name : undefined;
  const message = typeof err.message === 'string' ? err.message : '';
  const lowerMsg = message.toLowerCase();
  const lowerCode = code ? code.toLowerCase() : '';

  // 1. Server busy: HTTP 503, code SERVER_BUSY, or message SERVER_BUSY
  if (status === 503 || code === 'SERVER_BUSY' || message === 'SERVER_BUSY') {
    let retryAfterSeconds: number | undefined;
    if (typeof err.retryAfter === 'number' && !isNaN(err.retryAfter)) {
      retryAfterSeconds = err.retryAfter;
    } else if (typeof err.retryAfter === 'string') {
      const parsed = parseInt(err.retryAfter, 10);
      if (!isNaN(parsed)) {
        retryAfterSeconds = parsed;
      }
    }

    return {
      title: STRINGS.errors.serverBusyTitle,
      body: STRINGS.errors.serverBusyBody,
      kind: 'server_busy',
      retryAfter: retryAfterSeconds,
    };
  }

  // 2. No connection: status 0, timeout, fetch failed, network errors
  if (
    status === 0 ||
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network request failed') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('could not connect') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('connection refused') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('ehostunreach') ||
    lowerMsg.includes('net::err') ||
    lowerCode.includes('econnrefused') ||
    lowerCode.includes('enotfound') ||
    lowerCode.includes('timeout')
  ) {
    return {
      title: STRINGS.errors.noConnectionTitle,
      body: STRINGS.errors.noConnectionBody,
      kind: 'no_connection',
    };
  }

  // 3. Generic fallback for anything else
  return {
    title: STRINGS.errors.genericTitle,
    body: STRINGS.errors.genericBody,
    kind: 'generic',
  };
}

/**
 * Resolves a single user-displayable error message string.
 * - Kind 'no_connection' or 'server_busy': returns that copy's body.
 * - Status 400-499 with a non-empty message: returns error.message (server's envelope message).
 * - Else (5xx, no status, unknown): returns fallback if given, otherwise generic body.
 * Raw technical messages (e.g. 'fetch failed', 'Request timed out') never leak.
 */
export function getDisplayMessage(error: unknown, fallback?: string): string {
  const copy = getErrorCopy(error);
  if (copy.kind === 'no_connection' || copy.kind === 'server_busy') {
    return copy.body;
  }

  const err = error as { status?: unknown; message?: unknown } | null | undefined;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const message = typeof err?.message === 'string' ? err.message.trim() : '';

  if (status !== undefined && status >= 400 && status < 500 && message.length > 0) {
    const lower = message.toLowerCase();
    if (
      lower.includes('fetch failed') ||
      lower.includes('request timed out') ||
      lower.includes('failed to fetch') ||
      lower.includes('network request failed')
    ) {
      return STRINGS.errors.noConnectionBody;
    }
    return message;
  }

  if (fallback && fallback.trim().length > 0) {
    return fallback;
  }

  return copy.body;
}

