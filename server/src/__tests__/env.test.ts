import { describe, expect, it } from 'vitest';
import { validateEnv } from '../env.js';

describe('Server Environment Validation (Rule 02)', () => {
  const validBaseEnv: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://avue_user:pass@localhost:5432/avue_db',
    REDIS_URL: 'redis://localhost:6379',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
  };

  it('validates a complete, compliant environment configuration', () => {
    const env = validateEnv(validBaseEnv);
    expect(env.DATABASE_URL).toBe(validBaseEnv.DATABASE_URL);
    expect(env.REDIS_URL).toBe(validBaseEnv.REDIS_URL);
    expect(env.BODY_LIMIT_KB).toBe(100);
    expect(env.REQUEST_TIMEOUT_MS).toBe(10000);
    expect(env.SESSION_CACHE_IDLE_SECONDS).toBe(60);
    expect(env.SESSION_CACHE_MAX_SECONDS).toBe(300);
    expect(env.SESSION_VERIFY_MAX_WAIT_MS).toBe(2000);
  });

  it('fails fast and reports KEY NAMES ONLY when required variables are missing', () => {
    const incompleteEnv = {
      NODE_ENV: 'test',
    };

    expect(() => validateEnv(incompleteEnv)).toThrowError(/DATABASE_URL/);
    expect(() => validateEnv(incompleteEnv)).toThrowError(/REDIS_URL/);

    // Verify that NO secret values or passwords are printed in the error message
    try {
      validateEnv(incompleteEnv);
    } catch (err: any) {
      expect(err.message).toContain('DATABASE_URL');
      expect(err.message).not.toContain('password');
      expect(err.message).not.toContain('secret');
    }
  });

  it('refuses boot if PAYMENT_SIMULATOR is true in production (Rule 02)', () => {
    const invalidProdEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      PAYMENT_SIMULATOR: 'true',
      FLUTTERWAVE_SECRET_HASH: 'dummy_hash',
      FLUTTERWAVE_SECRET_KEY: 'dummy_key',
    };

    expect(() => validateEnv(invalidProdEnv)).toThrowError(
      /PAYMENT_SIMULATOR must be false in production/,
    );
  });

  it('fails production boot when FLUTTERWAVE_SECRET_HASH or FLUTTERWAVE_SECRET_KEY is missing or whitespace, reporting KEY NAMES ONLY', () => {
    const prodEnvWithoutFlw = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: '587',
      SMTP_USER: 'relay-user',
      SMTP_PASS: 'relay-pass',
    };

    // 1. Missing both: fails and error contains key names only
    try {
      validateEnv(prodEnvWithoutFlw);
      expect.unreachable('Should have thrown on missing Flutterwave keys');
    } catch (err: any) {
      expect(err.message).toContain('FLUTTERWAVE_SECRET_HASH');
      expect(err.message).toContain('FLUTTERWAVE_SECRET_KEY');
      expect(err.message).toContain('[FATAL] Environment configuration failure. Invalid or missing environment keys:');
      // Rule 02: KEY NAMES ONLY, never leak values
      expect(err.message).not.toContain('relay-pass');
    }

    // 2. Missing FLUTTERWAVE_SECRET_KEY
    try {
      validateEnv({
        ...prodEnvWithoutFlw,
        FLUTTERWAVE_SECRET_HASH: 'dummy_hash',
      });
      expect.unreachable('Should have thrown on missing FLUTTERWAVE_SECRET_KEY');
    } catch (err: any) {
      expect(err.message).toContain('FLUTTERWAVE_SECRET_KEY');
      expect(err.message).not.toContain('FLUTTERWAVE_SECRET_HASH');
      expect(err.message).not.toContain('dummy_hash');
    }

    // 3. Whitespace-only FLUTTERWAVE_SECRET_HASH
    try {
      validateEnv({
        ...prodEnvWithoutFlw,
        FLUTTERWAVE_SECRET_HASH: '   ',
        FLUTTERWAVE_SECRET_KEY: 'dummy_key',
      });
      expect.unreachable('Should have thrown on whitespace FLUTTERWAVE_SECRET_HASH');
    } catch (err: any) {
      expect(err.message).toContain('FLUTTERWAVE_SECRET_HASH');
      expect(err.message).not.toContain('dummy_key');
    }

    // 4. Whitespace-only FLUTTERWAVE_SECRET_KEY
    try {
      validateEnv({
        ...prodEnvWithoutFlw,
        FLUTTERWAVE_SECRET_HASH: 'dummy_hash',
        FLUTTERWAVE_SECRET_KEY: '   ',
      });
      expect.unreachable('Should have thrown on whitespace FLUTTERWAVE_SECRET_KEY');
    } catch (err: any) {
      expect(err.message).toContain('FLUTTERWAVE_SECRET_KEY');
      expect(err.message).not.toContain('dummy_hash');
    }
  });

  it('keeps assistant rate limit defaults unchanged (10 user/min, 30 IP/min)', () => {
    const env = validateEnv(validBaseEnv);
    expect(env.ASSISTANT_RATE_USER_PER_MIN).toBe(10);
    expect(env.ASSISTANT_RATE_IP_PER_MIN).toBe(30);
  });

  it('applies assistant rate limit overrides when valid', () => {
    const env = validateEnv({
      ...validBaseEnv,
      ASSISTANT_RATE_USER_PER_MIN: '20',
      ASSISTANT_RATE_IP_PER_MIN: '45',
    });
    expect(env.ASSISTANT_RATE_USER_PER_MIN).toBe(20);
    expect(env.ASSISTANT_RATE_IP_PER_MIN).toBe(45);
  });

  it('fails env validation for invalid assistant rate limit values (positive integers only, max 600)', () => {
    expect(() => validateEnv({ ...validBaseEnv, ASSISTANT_RATE_USER_PER_MIN: '0' })).toThrowError(/ASSISTANT_RATE_USER_PER_MIN/);
    expect(() => validateEnv({ ...validBaseEnv, ASSISTANT_RATE_IP_PER_MIN: '0' })).toThrowError(/ASSISTANT_RATE_IP_PER_MIN/);
    expect(() => validateEnv({ ...validBaseEnv, ASSISTANT_RATE_USER_PER_MIN: '-1' })).toThrowError(/ASSISTANT_RATE_USER_PER_MIN/);
    expect(() => validateEnv({ ...validBaseEnv, ASSISTANT_RATE_IP_PER_MIN: '601' })).toThrowError(/ASSISTANT_RATE_IP_PER_MIN/);
    expect(() => validateEnv({ ...validBaseEnv, ASSISTANT_RATE_USER_PER_MIN: '1.5' })).toThrowError(/ASSISTANT_RATE_USER_PER_MIN/);
  });

  it('accepts optional GEMINI_FALLBACK_MODEL with no default', () => {
    const withoutFallback = validateEnv(validBaseEnv) as any;
    expect(withoutFallback.GEMINI_FALLBACK_MODEL).toBeUndefined();

    const withFallback = validateEnv({
      ...validBaseEnv,
      GEMINI_FALLBACK_MODEL: 'gemini-fallback-test',
    }) as any;
    expect(withFallback.GEMINI_FALLBACK_MODEL).toBe('gemini-fallback-test');
  });

  it('defaults WEB_ALLOWED_ORIGINS to empty and parses trimmed exact origins', () => {
    expect(validateEnv(validBaseEnv).WEB_ALLOWED_ORIGINS).toEqual([]);

    const withOrigins = validateEnv({
      ...validBaseEnv,
      WEB_ALLOWED_ORIGINS: ' https://cinema.example , http://localhost:19006 ',
    });
    expect(withOrigins.WEB_ALLOWED_ORIGINS).toEqual([
      'https://cinema.example',
      'http://localhost:19006',
    ]);
  });

  it('refuses wildcard web origins', () => {
    expect(() =>
      validateEnv({ ...validBaseEnv, WEB_ALLOWED_ORIGINS: '*' }),
    ).toThrowError(/WEB_ALLOWED_ORIGINS/);
  });

  it('defaults the assistant attempt timeout to 15000 ms, including a blank documented value', () => {
    expect(validateEnv(validBaseEnv).GEMINI_ATTEMPT_TIMEOUT_MS).toBe(15000);
    expect(validateEnv({ ...validBaseEnv, GEMINI_ATTEMPT_TIMEOUT_MS: '' }).GEMINI_ATTEMPT_TIMEOUT_MS).toBe(15000);
    expect(validateEnv({ ...validBaseEnv, GEMINI_ATTEMPT_TIMEOUT_MS: '   ' }).GEMINI_ATTEMPT_TIMEOUT_MS).toBe(15000);
  });

  it('applies a valid assistant attempt timeout override and rejects values outside 2000-15000 ms', () => {
    expect(validateEnv({ ...validBaseEnv, GEMINI_ATTEMPT_TIMEOUT_MS: '15000' }).GEMINI_ATTEMPT_TIMEOUT_MS).toBe(15000);
    expect(validateEnv({ ...validBaseEnv, GEMINI_ATTEMPT_TIMEOUT_MS: '2000' }).GEMINI_ATTEMPT_TIMEOUT_MS).toBe(2000);
    for (const value of ['1999', '15001', '1.5', 'oops']) {
      expect(() => validateEnv({ ...validBaseEnv, GEMINI_ATTEMPT_TIMEOUT_MS: value })).toThrowError(
        /GEMINI_ATTEMPT_TIMEOUT_MS/,
      );
    }
  });
});

