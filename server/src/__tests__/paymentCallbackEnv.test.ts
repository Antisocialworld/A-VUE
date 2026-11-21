import { describe, expect, it } from 'vitest';
import { validateEnv } from '../env.js';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost/avue',
  REDIS_URL: 'redis://localhost:6379',
};

describe('Payment callback environment validation', () => {
  it('accepts and trims PUBLIC_API_URL', () => {
    const validated = validateEnv({
      ...BASE_ENV,
      PUBLIC_API_URL: '  https://api.example.com/  ',
    });
    expect(validated.PUBLIC_API_URL).toBe('https://api.example.com');
  });

  it('accepts and trims a custom-scheme APP_RETURN_URL', () => {
    const validated = validateEnv({
      ...BASE_ENV,
      APP_RETURN_URL: ' avue://payment-return/ ',
    });
    expect(validated.APP_RETURN_URL).toBe('avue://payment-return');
  });

  it('rejects non-URL values for both new config keys', () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, PUBLIC_API_URL: 'not-a-url' }),
    ).toThrowError(/PUBLIC_API_URL/);
    expect(() =>
      validateEnv({ ...BASE_ENV, APP_RETURN_URL: 'not-a-url' }),
    ).toThrowError(/APP_RETURN_URL/);
  });
});
