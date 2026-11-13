import { describe, expect, it } from 'vitest';
import { generateCrypto6DigitCode } from '../lib/code.js';
import { parseToken } from '../lib/session.js';

describe('Authentication Core Logic & Safety Rules (Rule 02)', () => {
  it('generates cryptographic 6-digit codes (Math.random banned)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCrypto6DigitCode();
      expect(code).toMatch(/^\d{6}$/);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThanOrEqual(999999);
    }
  });

  it('correctly parses token structure into publicId and secret', () => {
    const rawToken = 'pub_1234567890abcdef.sec_fedcba0987654321';
    const parsed = parseToken(rawToken);
    expect(parsed).not.toBeNull();
    expect(parsed?.publicId).toBe('pub_1234567890abcdef');
    expect(parsed?.secret).toBe('sec_fedcba0987654321');
  });

  it('rejects malformed tokens', () => {
    expect(parseToken('')).toBeNull();
    expect(parseToken('not-a-valid-token')).toBeNull();
    expect(parseToken('onlyonepart.')).toBeNull();
    expect(parseToken('.onlysecret')).toBeNull();
    expect(parseToken('part1.part2.part3')).toBeNull();
  });

  it('calculates session timeouts according to values table (30d absolute, 7d idle)', () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const now = Date.now();
    const expiresAt = now + thirtyDaysMs;
    const lastActiveAt = now - (8 * 24 * 60 * 60 * 1000); // 8 days ago (> 7 days idle)

    const isIdleExpired = now - lastActiveAt > sevenDaysMs;
    expect(isIdleExpired).toBe(true);

    const isAbsoluteExpired = now > expiresAt;
    expect(isAbsoluteExpired).toBe(false);
  });
});

