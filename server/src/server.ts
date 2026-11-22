import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env.js';
import { healthRoutes } from './routes/health.js';
import { devRoutes } from './routes/dev.js';
import { authRoutes } from './routes/auth.js';
import { movieRoutes } from './routes/movies.js';
import { showtimeRoutes } from './routes/showtimes.js';
import { checkoutRoutes } from './routes/checkout.js';
import { paymentCallbackRoutes } from './routes/paymentCallback.js';
import { webhookRoutes } from './routes/webhooks.js';
import { ticketRoutes } from './routes/tickets.js';
import { cronRoutes } from './routes/cron.js';
import { assistantRoutes } from './routes/assistant.js';
import { warnIfPublicApiUrlMissing } from './lib/flutterwave.js';

let cachedApp: FastifyInstance | null = null;

export function serializeRequest(req: { id?: string; method?: string; url?: string }): {
  id?: string;
  method?: string;
  url: string;
} {
  const rawUrl = req.url || '';
  const queryIdx = rawUrl.indexOf('?');
  const cleanUrl = queryIdx !== -1 ? rawUrl.slice(0, queryIdx) : rawUrl;
  return {
    id: req.id,
    method: req.method,
    url: cleanUrl,
  };
}

export async function buildServer(): Promise<FastifyInstance> {
  warnIfPublicApiUrlMissing();

  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      serializers: {
        req: serializeRequest,
      },
    },
    genReqId() {
      return crypto.randomUUID();
    },
    bodyLimit: env.BODY_LIMIT_KB * 1024, // 100 KB limit from AGENTS.md
    connectionTimeout: env.REQUEST_TIMEOUT_MS, // 10 s limit from AGENTS.md
    trustProxy: env.TRUST_PROXY,
  });

  // Preserve raw request body for Flutterwave webhook signature verification (Rule 02)
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: any, body: Buffer, done: (err: Error | null, result?: any) => void) => {
      try {
        req.rawBody = body;
        const json = body.length > 0 ? JSON.parse(body.toString('utf-8')) : {};
        done(null, json);
      } catch (err: any) {
        done(err);
      }
    }
  );

  // Web CORS: only exact configured origins are echoed. Empty list keeps prior behaviour.
  const allowedWebOrigins = new Set(env.WEB_ALLOWED_ORIGINS ?? []);
  fastify.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedWebOrigins.has(origin)) {
      return;
    }

    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, Accept');

    if (request.method === 'OPTIONS') {
      reply.status(204).send();
      return;
    }
  });

  // Security Headers Hook (Rule 02: nosniff, frame deny, HSTS, no referrer)
  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  // Safe Generic Error Envelope (Rule 02: never prints a stack trace, never leaks secrets)
  fastify.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    // Log the error internally with request ID
    request.log.error({
      requestId: request.id,
      err: error.message,
    });

    // Clear 503 for SERVER_BUSY: custom message and Retry-After header (Task B)
    if (statusCode === 503 && error.code === 'SERVER_BUSY') {
      const retryAfter = error.retryAfter ?? error.headers?.['Retry-After'] ?? 2;
      reply.header('Retry-After', String(retryAfter));
      return reply.status(503).send({
        error: {
          code: 'SERVER_BUSY',
          message: error.message,
          requestId: request.id,
        },
      });
    }

    const isClientError = statusCode < 500;
    const message = isClientError ? error.message : 'An internal server error occurred.';
    const code = error.code || (isClientError ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR');

    return reply.status(statusCode).send({
      error: {
        code,
        message,
        requestId: request.id,
      },
    });
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(devRoutes);
  await fastify.register(authRoutes);
  await fastify.register(movieRoutes);
  await fastify.register(showtimeRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(paymentCallbackRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(ticketRoutes);
  await fastify.register(cronRoutes);
  await fastify.register(assistantRoutes);

  return fastify;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cachedApp) {
    cachedApp = await buildServer();
    await cachedApp.ready();
  }
  cachedApp.server.emit('request', req, res);
}

