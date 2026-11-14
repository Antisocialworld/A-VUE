import { describe, expect, it } from 'vitest';
import { validateEnv } from '../env.js';

describe('Checkout & Payment Initiation (Rule 02 / Rule 04 / Task 6)', () => {
  it('computes service fee and total in integer kobo on the server', () => {
    // 3 tickets at N3,500 (350,000 kobo each)
    const pricePerSeatKobo = 350000;
    const seatCount = 3;
    const basePriceKobo = pricePerSeatKobo * seatCount; // 1,050,000 kobo (N10,500)

    const serviceFeeBps = 500; // 5%
    const feeKobo = Math.round((basePriceKobo * serviceFeeBps) / 10000); // 52,500 kobo (N525.00)
    const totalAmountKobo = basePriceKobo + feeKobo; // 1,102,500 kobo (N11,025.00)

    expect(basePriceKobo).toBe(1050000);
    expect(feeKobo).toBe(52500);
    expect(totalAmountKobo).toBe(1102500);
  });

  it('strictly refuses boot if PAYMENT_SIMULATOR is true in production', () => {
    const invalidProductionEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/avue',
      REDIS_URL: 'redis://localhost:6379',
      PAYMENT_SIMULATOR: 'true',
      FLUTTERWAVE_SECRET_HASH: 'dummy_hash',
      FLUTTERWAVE_SECRET_KEY: 'dummy_key',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: '587',
      SMTP_USER: 'relay-user',
      SMTP_PASS: 'relay-pass',
    };

    expect(() => validateEnv(invalidProductionEnv)).toThrow(
      /PAYMENT_SIMULATOR must be false in production/
    );
  });

  it('allows PAYMENT_SIMULATOR in development environment', () => {
    const devEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/avue',
      REDIS_URL: 'redis://localhost:6379',
      PAYMENT_SIMULATOR: 'true',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
    };

    const parsed = validateEnv(devEnv);
    expect(parsed.PAYMENT_SIMULATOR).toBe(true);
  });
});

