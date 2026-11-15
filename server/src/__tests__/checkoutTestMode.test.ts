import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Server Flutterwave testMode Flag Contract (Task 3)', () => {
  const flutterwavePath = path.resolve(__dirname, '../lib/flutterwave.ts');
  const checkoutRoutePath = path.resolve(__dirname, '../routes/checkout.ts');

  const flutterwaveSrc = fs.readFileSync(flutterwavePath, 'utf-8');
  const checkoutRouteSrc = fs.readFileSync(checkoutRoutePath, 'utf-8');

  it('derives isFlutterwaveTestMode from FLWSECK_TEST prefix and PAYMENT_SIMULATOR', () => {
    expect(flutterwaveSrc).toContain('export function isFlutterwaveTestMode(): boolean');
    expect(flutterwaveSrc).toContain("startsWith('FLWSECK_TEST')");
    expect(flutterwaveSrc).toContain('env.PAYMENT_SIMULATOR');
  });

  it('never prints, logs, or returns any secret key', () => {
    expect(flutterwaveSrc).not.toMatch(/return\s+.*FLUTTERWAVE_SECRET_KEY/);
    expect(checkoutRouteSrc).not.toMatch(/send\(.*FLUTTERWAVE_SECRET_KEY/);
  });

  it('exposes minimal public GET /checkout/config returning testMode boolean', () => {
    expect(checkoutRouteSrc).toContain("fastify.get('/checkout/config'");
    expect(checkoutRouteSrc).toContain('testMode: isFlutterwaveTestMode()');
  });

  it('includes testMode boolean in POST /checkout responses', () => {
    expect(checkoutRouteSrc).toContain("fastify.post('/checkout'");
    expect(checkoutRouteSrc).toMatch(/testMode:\s*isFlutterwaveTestMode\(\)/);
  });
});
