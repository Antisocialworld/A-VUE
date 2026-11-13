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
    };

    expect(() => validateEnv(invalidProdEnv)).toThrowError(
      /PAYMENT_SIMULATOR must be false in production/,
    );
  });
});

