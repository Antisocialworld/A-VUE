import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost/avue',
  REDIS_URL: 'redis://localhost:6379',
};

async function loadFlutterwave(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(k, v);
  }
  return import('../lib/flutterwave.js');
}

describe('Server Flutterwave testMode Flag Contract (Task 3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

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

describe('Y1: Simulator link reachability and safety', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('builds simulator link from request host (protocol + Host) and never reads env.HOST', async () => {
    const { createFlutterwavePaymentLink, resolveSimulatorBaseUrl } = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'true',
      HOST: '0.0.0.0',
      PORT: '3000',
    });

    const baseUrl = resolveSimulatorBaseUrl({
      protocol: 'http',
      hostHeader: '192.168.1.20:3000',
      trustProxy: false,
    });
    expect(baseUrl).toBe('http://192.168.1.20:3000');

    const res = await createFlutterwavePaymentLink({
      paymentId: 'p1',
      txRef: 'avue_testref',
      amountKobo: 12345,
      userEmail: 'user@example.com',
      simulatorBaseUrl: baseUrl ?? undefined,
    });
    expect(res.isSimulated).toBe(true);
    expect(res.paymentLink).toBe(
      'http://192.168.1.20:3000/dev/simulate-payment?tx_ref=avue_testref&amount=12345'
    );
    expect(res.paymentLink).not.toContain('0.0.0.0');
  });

  it('prefers PUBLIC_API_URL when set and valid', async () => {
    const { resolveSimulatorBaseUrl } = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'true',
    });

    const baseUrl = resolveSimulatorBaseUrl({
      publicApiUrl: 'https://api.example.test',
      protocol: 'http',
      hostHeader: '192.168.1.20:3000',
      trustProxy: false,
    });
    expect(baseUrl).toBe('https://api.example.test');
  });

  it('honors forwarded host/proto only when TRUST_PROXY is enabled', async () => {
    const { resolveSimulatorBaseUrl } = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'true',
    });

    const trusted = resolveSimulatorBaseUrl({
      protocol: 'http',
      hostHeader: 'internal:3000',
      forwardedHost: 'api.public.example',
      forwardedProto: 'https',
      trustProxy: 1,
    });
    expect(trusted).toBe('https://api.public.example');

    const untrusted = resolveSimulatorBaseUrl({
      protocol: 'http',
      hostHeader: '192.168.1.20:3000',
      forwardedHost: 'api.public.example',
      forwardedProto: 'https',
      trustProxy: false,
    });
    expect(untrusted).toBe('http://192.168.1.20:3000');
  });

  it('never emits 0.0.0.0, 127.0.0.1, or localhost and rejects malformed host', async () => {
    const { resolveSimulatorBaseUrl } = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'true',
    });

    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: '0.0.0.0:3000', trustProxy: false })).toBeNull();
    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: '127.0.0.1:3000', trustProxy: false })).toBeNull();
    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: 'localhost:3000', trustProxy: false })).toBeNull();
    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: '[::1]:3000', trustProxy: false })).toBeNull();
    // malformed / unsafe host characters (path injection, spaces, userinfo-like, invalid symbols)
    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: 'evil.example/../../x', trustProxy: false })).toBeNull();
    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: 'exa mple.com', trustProxy: false })).toBeNull();
    expect(resolveSimulatorBaseUrl({ protocol: 'http', hostHeader: 'user@host.com', trustProxy: false })).toBeNull();
    expect(resolveSimulatorBaseUrl({ publicApiUrl: 'http://localhost:3000', protocol: 'http', hostHeader: 'ok.example', trustProxy: false })).toBe(
      'http://ok.example'
    ); // invalid PUBLIC_API_URL falls back safely to valid request host
    expect(resolveSimulatorBaseUrl({ publicApiUrl: 'http://0.0.0.0:3000', protocol: 'http', hostHeader: '0.0.0.0:3000', trustProxy: false })).toBeNull();
  });

  it('does not emit an unsafe simulator link when no safe base is available', async () => {
    const { createFlutterwavePaymentLink } = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'true',
      HOST: '0.0.0.0',
      PORT: '3000',
    });

    await expect(
      createFlutterwavePaymentLink({
        paymentId: 'p1',
        txRef: 'avue_testref',
        amountKobo: 12345,
        userEmail: 'user@example.com',
        // simulatorBaseUrl omitted / unavailable
      })
    ).rejects.toThrow('SIMULATOR_BASE_URL_UNAVAILABLE');
  });

  it('keeps real Flutterwave link behaviour unchanged when simulator is off', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { link: 'https://checkout.flutterwave.com/pay/real-link' } }),
      text: async () => '',
    })) as any;
    vi.stubGlobal('fetch', fetchMock);

    const { createFlutterwavePaymentLink } = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'false',
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-xxxxxxxxxxxxxxxx',
      HOST: '0.0.0.0',
      PORT: '3000',
    });

    const res = await createFlutterwavePaymentLink({
      paymentId: 'p1',
      txRef: 'avue_realref',
      amountKobo: 500000,
      userEmail: 'user@example.com',
      movieTitle: 'A VUE Cinema Tickets',
      // no simulatorBaseUrl required/used in real path
    });

    expect(res).toEqual({ paymentLink: 'https://checkout.flutterwave.com/pay/real-link', isSimulated: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.flutterwave.com');
  });

  it('checkout simulator route logs hit/outcome (non-sensitive) and avoids full tx_ref in logs', () => {
    const checkoutRoutePath = path.resolve(__dirname, '../routes/checkout.ts');
    const checkoutSrc = fs.readFileSync(checkoutRoutePath, 'utf-8');
    expect(checkoutSrc).toContain("[Dev Simulator] simulate-payment hit");
    expect(checkoutSrc).toContain("[Dev Simulator] simulate-payment outcome: payment_id=");
    expect(checkoutSrc).toContain("status=${resultStatus}");
    // must not log tx_ref value or full request URL/query in simulator logs
    expect(checkoutSrc).not.toContain('simulate-payment hit: ${tx_ref}');
    expect(checkoutSrc).not.toContain('outcome: payment_id=${payment.id} tx_ref=');
  });
});
