import { describe, expect, it } from 'vitest';
import { getDisplayMessage, getErrorCopy } from '../utils/error';
import { STRINGS } from '../constants/strings';

describe('getErrorCopy Mapper Unit Tests (Task 1)', () => {
  describe('Kind 1: no_connection', () => {
    it('maps fetch failed TypeError to no_connection copy without leaking raw error text', () => {
      const rawError = new TypeError('fetch failed: Could not connect to the server.');
      const copy = getErrorCopy(rawError);

      expect(copy.kind).toBe('no_connection');
      expect(copy.title).toBe(STRINGS.errors.noConnectionTitle);
      expect(copy.body).toBe(STRINGS.errors.noConnectionBody);
      expect(copy.title).toBe("Can't connect");
      expect(copy.body).toBe('Check your internet connection and try again.');

      // Raw technical text must never leak into user-facing title or body
      expect(copy.title).not.toContain('fetch failed');
      expect(copy.body).not.toContain('fetch failed');
      expect(copy.title).not.toContain('Could not connect');
      expect(copy.body).not.toContain('Could not connect');
    });

    it('maps AbortError / timeout error to no_connection copy', () => {
      const abortError = new Error('Request timed out. Please check your connection.');
      abortError.name = 'AbortError';
      (abortError as any).status = 0;

      const copy = getErrorCopy(abortError);
      expect(copy.kind).toBe('no_connection');
      expect(copy.title).toBe(STRINGS.errors.noConnectionTitle);
      expect(copy.body).toBe(STRINGS.errors.noConnectionBody);
    });

    it('maps status 0 network drop error to no_connection copy', () => {
      const networkError = {
        status: 0,
        message: 'Network request failed',
      };

      const copy = getErrorCopy(networkError);
      expect(copy.kind).toBe('no_connection');
      expect(copy.title).toBe(STRINGS.errors.noConnectionTitle);
      expect(copy.body).toBe(STRINGS.errors.noConnectionBody);
    });

    it('maps connection refused / ECONNREFUSED to no_connection copy', () => {
      const connError = {
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:3000',
      };

      const copy = getErrorCopy(connError);
      expect(copy.kind).toBe('no_connection');
      expect(copy.title).toBe(STRINGS.errors.noConnectionTitle);
      expect(copy.body).toBe(STRINGS.errors.noConnectionBody);
    });
  });

  describe('Kind 2: server_busy', () => {
    it('maps HTTP 503 SERVER_BUSY response to server_busy copy', () => {
      const busyError = {
        status: 503,
        code: 'SERVER_BUSY',
        message: 'Server is currently at capacity',
      };

      const copy = getErrorCopy(busyError);
      expect(copy.kind).toBe('server_busy');
      expect(copy.title).toBe(STRINGS.errors.serverBusyTitle);
      expect(copy.body).toBe(STRINGS.errors.serverBusyBody);
      expect(copy.title).toBe("We're busy right now");
      expect(copy.body).toBe('Lots of people are booking. Try again in a few seconds.');

      // Technical code must never leak
      expect(copy.title).not.toContain('503');
      expect(copy.body).not.toContain('503');
      expect(copy.title).not.toContain('SERVER_BUSY');
      expect(copy.body).not.toContain('SERVER_BUSY');
    });

    it('honours numeric retryAfter property when exposed by client', () => {
      const busyErrorWithRetry = {
        status: 503,
        code: 'SERVER_BUSY',
        retryAfter: 5,
      };

      const copy = getErrorCopy(busyErrorWithRetry);
      expect(copy.kind).toBe('server_busy');
      expect(copy.retryAfter).toBe(5);
      expect(copy.title).toBe(STRINGS.errors.serverBusyTitle);
      expect(copy.body).toBe(STRINGS.errors.serverBusyBody);
    });

    it('honours string retryAfter header value when exposed by client', () => {
      const busyErrorWithStringRetry = {
        status: 503,
        code: 'SERVER_BUSY',
        retryAfter: '12',
      };

      const copy = getErrorCopy(busyErrorWithStringRetry);
      expect(copy.kind).toBe('server_busy');
      expect(copy.retryAfter).toBe(12);
    });
  });

  describe('Kind 3: generic', () => {
    it('maps arbitrary 500 error to generic copy without leaking stack or database details', () => {
      const serverCrash = new Error('Internal Server Error 500: syntax error at or near "SELECT"');
      serverCrash.stack = 'Error: Internal Server Error\n    at pgClient.query (server/src/db.ts:42)';

      const copy = getErrorCopy(serverCrash);
      expect(copy.kind).toBe('generic');
      expect(copy.title).toBe(STRINGS.errors.genericTitle);
      expect(copy.body).toBe(STRINGS.errors.genericBody);
      expect(copy.title).toBe('Something went wrong');
      expect(copy.body).toBe('Please try again.');

      // Leaked database or stack text must be strictly absent
      expect(copy.title).not.toContain('SELECT');
      expect(copy.body).not.toContain('SELECT');
      expect(copy.title).not.toContain('postgres');
      expect(copy.body).not.toContain('server/src');
    });

    it('handles null, undefined, and non-error values gracefully with generic copy', () => {
      expect(getErrorCopy(null).kind).toBe('generic');
      expect(getErrorCopy(undefined).kind).toBe('generic');
      expect(getErrorCopy({}).kind).toBe('generic');
      expect(getErrorCopy('unexpected string error').kind).toBe('generic');
    });
  });

  describe('Strings file & button label contract', () => {
    it('verifies all 3 title/body pairs and tryAgain button label exist in STRINGS.errors', () => {
      expect(STRINGS.errors.noConnectionTitle).toBe("Can't connect");
      expect(STRINGS.errors.noConnectionBody).toBe('Check your internet connection and try again.');
      expect(STRINGS.errors.serverBusyTitle).toBe("We're busy right now");
      expect(STRINGS.errors.serverBusyBody).toBe('Lots of people are booking. Try again in a few seconds.');
      expect(STRINGS.errors.genericTitle).toBe('Something went wrong');
      expect(STRINGS.errors.genericBody).toBe('Please try again.');
      expect(STRINGS.errors.tryAgain).toBe('Try again');
    });
  });

  describe('getDisplayMessage Unit Tests (Task 1)', () => {
    it('network failure returns the no-connection body', () => {
      const netErr = new TypeError('fetch failed: Could not connect to the server.');
      const msg = getDisplayMessage(netErr, 'Fallback message');
      expect(msg).toBe(STRINGS.errors.noConnectionBody);
      expect(msg).toBe('Check your internet connection and try again.');
      expect(msg).not.toContain('fetch failed');
    });

    it('503 returns the busy body', () => {
      const busyErr = { status: 503, code: 'SERVER_BUSY', message: 'SERVER_BUSY' };
      const msg = getDisplayMessage(busyErr, 'Fallback message');
      expect(msg).toBe(STRINGS.errors.serverBusyBody);
      expect(msg).toBe('Lots of people are booking. Try again in a few seconds.');
      expect(msg).not.toContain('503');
      expect(msg).not.toContain('SERVER_BUSY');
    });

    it('status 409 with message returns that message', () => {
      const conflictErr = {
        status: 409,
        code: 'SEAT_UNAVAILABLE',
        message: 'One or more selected seats were taken by another user.',
      };
      const msg = getDisplayMessage(conflictErr, 'Fallback message');
      expect(msg).toBe('One or more selected seats were taken by another user.');
    });

    it('status 401 returns the server message', () => {
      const authErr = {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password. Please try again.',
      };
      const msg = getDisplayMessage(authErr, 'Fallback message');
      expect(msg).toBe('Invalid email or password. Please try again.');
    });

    it('status 500 with SQL-like text returns the generic body (no leak)', () => {
      const sqlErr = {
        status: 500,
        message: 'syntax error at or near "SELECT" from bookings table',
      };
      const msg = getDisplayMessage(sqlErr);
      expect(msg).toBe(STRINGS.errors.genericBody);
      expect(msg).toBe('Please try again.');
      expect(msg).not.toContain('SELECT');
      expect(msg).not.toContain('bookings');
    });

    it('no status with message "fetch failed" returns the no-connection body', () => {
      const unattachedErr = {
        message: 'fetch failed',
      };
      const msg = getDisplayMessage(unattachedErr, 'Fallback message');
      expect(msg).toBe(STRINGS.errors.noConnectionBody);
      expect(msg).toBe('Check your internet connection and try again.');
      expect(msg).not.toContain('fetch failed');
    });

    it('fallback honoured for unhandled 5xx or unknown errors', () => {
      const server500Err = {
        status: 500,
        message: 'Internal server error',
      };
      const msgWithFallback = getDisplayMessage(server500Err, 'Custom fallback error message');
      expect(msgWithFallback).toBe('Custom fallback error message');

      const unknownErr = new Error('Unknown unhandled error without status');
      const msgUnknown = getDisplayMessage(unknownErr, 'Auth fallback message');
      expect(msgUnknown).toBe('Auth fallback message');
    });
  });
});
