import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { writerPool } from '../lib/db.js';
import { verifyFlutterwaveSignature } from '../lib/flutterwave.js';
import { processWebhookEvent } from '../lib/jobs.js';

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
      const eventId =
        payload?.id?.toString() ||
        payload?.data?.id?.toString() ||
        `evt_${payload?.data?.tx_ref}_${Date.now()}`;
      const eventType = payload?.event || payload?.['event.type'] || 'charge.completed';

      // 3. Deduplicate and store event
      const pool = writerPool;
      try {
        const insertRes = await pool.query(
          `INSERT INTO webhook_events (provider, event_id, event_type, payload, status)
           VALUES ('flutterwave', $1, $2, $3, 'received')
           ON CONFLICT (event_id) DO NOTHING
           RETURNING id`,
          [eventId, eventType, JSON.stringify(payload)]
        );

        // If duplicate event, return 200 fast without duplicate processing
        if (insertRes.rows.length === 0) {
          return reply.status(200).send({ received: true, deduplicated: true });
        }

        // Return 200 fast to payment provider
        reply.status(200).send({ received: true });

        // 4. Trigger processing in background (waitUntil simulation / non-blocking)
        setImmediate(async () => {
          try {
            await processWebhookEvent(eventId);
          } catch (err: any) {
            process.stderr.write(`[Webhook Background Error] Event ${eventId} failed: ${err.message}\n`);
          }
        });
      } catch (err: any) {
        process.stderr.write(`[Webhook Error] Failed to persist event: ${err.message}\n`);
        return reply.status(500).send({ error: 'Failed to record event' });
      }
    }
  );
}

