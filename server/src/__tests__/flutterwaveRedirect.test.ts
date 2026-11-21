import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost/avue',
  REDIS_URL: 'redis://localhost:6379',
};

async function loadFlutterwave(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
  return import('../lib/flutterwave.js');
}

function mockFlutterwaveFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data: { link: 'https://checkout.example/pay' } }),
    text: async () => '',
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function createRealLink(flutterwave: any, txRef = 'avue_realref') {
  const fetchMock = mockFlutterwaveFetch();
  await flutterwave.createFlutterwavePaymentLink({
    paymentId: 'pay-1',
    txRef,
    amountKobo: 500000,
    userEmail: 'owner@example.com',
    movieTitle: 'A VUE Cinema Tickets',
  });
  const init = fetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
  return JSON.parse(init?.body ?? '{}') as { redirect_url?: string };
}

describe('Flutterwave redirect_url', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses PUBLIC_API_URL when set, trimming its trailing slash', async () => {
    const flutterwave = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'false',
      FLUTTERWAVE_SECRET_KEY: 'dummy',
      PUBLIC_API_URL: 'https://api.example.com/',
      HOST: '0.0.0.0',
      PORT: '3000',
    });

    const body = await createRealLink(flutterwave);

    expect(body.redirect_url).toBe(
      'https://api.example.com/payments/callback?tx_ref=avue_realref',
    );
  });

  it('keeps the local HOST/PORT fallback when PUBLIC_API_URL is unset', async () => {
    const flutterwave = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'false',
      FLUTTERWAVE_SECRET_KEY: 'dummy',
      PUBLIC_API_URL: '',
      HOST: '0.0.0.0',
      PORT: '3000',
    });

    const body = await createRealLink(flutterwave);

    expect(body.redirect_url).toBe(
      'http://0.0.0.0:3000/payments/callback?tx_ref=avue_realref',
    );
  });

  it('logs one closed-set startup warning only when PUBLIC_API_URL is unset', async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as any);

    const unset = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'false',
      FLUTTERWAVE_SECRET_KEY: 'dummy',
      PUBLIC_API_URL: '',
    });
    unset.warnIfPublicApiUrlMissing();
    unset.warnIfPublicApiUrlMissing();

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      '[Flutterwave Config] warning=PUBLIC_API_URL_UNSET fallback=local_redirect\n',
    );

    stderrWrite.mockClear();
    const set = await loadFlutterwave({
      PAYMENT_SIMULATOR: 'false',
      FLUTTERWAVE_SECRET_KEY: 'dummy',
      PUBLIC_API_URL: 'https://api.example.com',
    });
    set.warnIfPublicApiUrlMissing();

    expect(stderrWrite).not.toHaveBeenCalled();
  });
});
