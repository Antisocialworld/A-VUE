import { afterEach, describe, expect, it, vi } from 'vitest';

async function buildCorsServer(webAllowedOrigins: string[]) {
  vi.resetModules();

  vi.doMock('../env.js', () => ({
    env: {
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '0.0.0.0',
      TRUST_PROXY: false,
      REQUEST_TIMEOUT_MS: 10000,
      BODY_LIMIT_KB: 100,
      WEB_ALLOWED_ORIGINS: webAllowedOrigins,
    },
  }));

  const noopRoutes = async () => {};
  vi.doMock('../routes/health.js', () => ({ healthRoutes: noopRoutes }));
  vi.doMock('../routes/dev.js', () => ({ devRoutes: noopRoutes }));
  vi.doMock('../routes/auth.js', () => ({ authRoutes: noopRoutes }));
  vi.doMock('../routes/movies.js', () => ({ movieRoutes: noopRoutes }));
  vi.doMock('../routes/showtimes.js', () => ({ showtimeRoutes: noopRoutes }));
  vi.doMock('../routes/checkout.js', () => ({ checkoutRoutes: noopRoutes }));
  vi.doMock('../routes/webhooks.js', () => ({ webhookRoutes: noopRoutes }));
  vi.doMock('../routes/tickets.js', () => ({ ticketRoutes: noopRoutes }));
  vi.doMock('../routes/cron.js', () => ({ cronRoutes: noopRoutes }));
  vi.doMock('../routes/assistant.js', () => ({ assistantRoutes: noopRoutes }));

  const { buildServer } = await import('../server.js');
  const server = await buildServer();
  server.get('/__cors-test', async () => ({ ok: true }));
  return server;
}

describe('Web CORS hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows a listed origin and keeps existing security headers', async () => {
    const origin = 'https://cinema.example';
    const server = await buildCorsServer([origin]);

    const res = await server.inject({ method: 'GET', url: '/__cors-test', headers: { origin } });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['vary']).toBe('Origin');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe(
      'Content-Type, Authorization, Idempotency-Key, Accept',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await server.close();
  });

  it('does not add CORS headers for an unlisted origin', async () => {
    const server = await buildCorsServer(['https://cinema.example']);

    const res = await server.inject({
      method: 'GET',
      url: '/__cors-test',
      headers: { origin: 'https://not-listed.example' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['vary']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
    expect(res.headers['access-control-allow-headers']).toBeUndefined();
    await server.close();
  });

  it('answers preflight for a listed origin with only the used methods and headers', async () => {
    const origin = 'http://localhost:19006';
    const server = await buildCorsServer([origin]);

    const res = await server.inject({
      method: 'OPTIONS',
      url: '/__cors-test',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, authorization, idempotency-key',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe(
      'Content-Type, Authorization, Idempotency-Key, Accept',
    );
    await server.close();
  });

  it('sends no CORS headers when the allowed-origin list is empty', async () => {
    const server = await buildCorsServer([]);

    const res = await server.inject({
      method: 'GET',
      url: '/__cors-test',
      headers: { origin: 'https://cinema.example' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['vary']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
    expect(res.headers['access-control-allow-headers']).toBeUndefined();
    await server.close();
  });
});
