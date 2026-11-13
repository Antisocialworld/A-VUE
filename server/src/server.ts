import crypto from 'node:crypto';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env.js';
import { healthRoutes } from './routes/health.js';
import { devRoutes } from './routes/dev.js';
import { authRoutes } from './routes/auth.js';
import { movieRoutes } from './routes/movies.js';
import { showtimeRoutes } from './routes/showtimes.js';
import { checkoutRoutes } from './routes/checkout.js';
import { webhookRoutes } from './routes/webhooks.js';
import { ticketRoutes } from './routes/tickets.js';
import { cronRoutes } from './routes/cron.js';

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
          };
        },
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

  // Security Headers Hook (Rule 02: nosniff, frame deny, HSTS. No CORS)
  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
  await fastify.register(webhookRoutes);
  await fastify.register(ticketRoutes);
  await fastify.register(cronRoutes);

  return fastify;
}

