import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { processPendingWebhookEvents } from '../lib/jobs.js';

export async function cronRoutes(fastify: FastifyInstance) {
  /**
   * POST /cron/jobs
   * Secured endpoint triggered by cron sweep.
   * Processes any pending webhook events or background tasks.
   * Requires Authorization: Bearer <CRON_SECRET>.
   * (Rule 04 / Task 7)
   */
  fastify.post('/cron/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const cronSecret = env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return reply.status(401).send({ error: 'Unauthorized cron request' });
    }

    try {
      const processedCount = await processPendingWebhookEvents();
      return reply.status(200).send({
        success: true,
        processedEvents: processedCount,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      process.stderr.write(`[Cron Error] Scheduled jobs run failed: ${err.message}\n`);
      return reply.status(500).send({ error: 'Cron execution failed' });
    }
  });
}

