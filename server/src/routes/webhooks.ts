import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyFlutterwaveSignature } from '../lib/flutterwave.js';
import { recordAndQueueFlutterwaveEvent } from '../lib/flutterwaveEvents.js';

export async function webhookRoutes(fastify: FastifyInstance) {
  /**
   * POST /webhooks/flutterwave
   * Flutterwave payment confirmation webhook.
   * Verifies signature via constant-time compare (crypto.timingSafeEqual).
   * Stores event with UNIQUE provider event_id and returns 200 fast.
   */
  fastify.post(
    '/webhooks/flutterwave',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Verify signature using raw body (or serialized body) and headers
      const rawBody = (request as any).rawBody || JSON.stringify(request.body || {});
      const isValid = verifyFlutterwaveSignature(rawBody, request.headers);

      if (!isValid) {
        process.stderr.write(`[Webhook Warning] Rejected Flutterwave webhook with invalid signature from IP ${request.ip}\n`);
        return reply.status(401).send({
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Webhook signature verification failed.',
            requestId: request.id,
          },
        });
      }

      // 2. Parse event payload
      const payload = request.body as any;

      // 3. Deduplicate, store and queue event (shared with verify fallback)
      try {
        const { inserted } = await recordAndQueueFlutterwaveEvent(payload);

        // If duplicate event, return 200 fast without duplicate processing
        if (!inserted) {
          return reply.status(200).send({ received: true, deduplicated: true });
        }

        // Return 200 fast to payment provider
        return reply.status(200).send({ received: true });
      } catch (err: any) {
        process.stderr.write(`[Webhook Error] Failed to persist event: ${err.message}\n`);
        return reply.status(500).send({ error: 'Failed to record event' });
      }
    }
  );
}

