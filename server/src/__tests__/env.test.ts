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
});

