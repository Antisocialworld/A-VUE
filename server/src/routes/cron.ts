import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { processPendingWebhookEvents } from '../lib/jobs.js';
import { query } from '../lib/db.js';

function verifyCronAuth(authHeader: string | undefined): boolean {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) return false;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const tokenBuf = Buffer.from(token, 'utf-8');
  const secretBuf = Buffer.from(cronSecret, 'utf-8');
  if (tokenBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, secretBuf);
}

export async function cronRoutes(fastify: FastifyInstance) {
  /**
   * POST /cron/jobs
   * Secured endpoint triggered by cron sweep.
   * Processes any pending webhook events or background tasks.
   * Requires Authorization: Bearer <CRON_SECRET>.
   * (Rule 04 / Task 7)
   */
  fastify.post('/cron/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyCronAuth(request.headers.authorization)) {
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

  /**
   * POST /cron/purge-users
   * Secured endpoint triggered by cron sweep.
   * Anonymises users whose deletion grace period has expired (purge_after < NOW()).
   * Guarded by CRON_SECRET with constant-time comparison (crypto.timingSafeEqual).
   * Retains ticket, booking, payment, and ledger history for financial/audit integrity.
   * (Task 4)
   */
  fastify.post('/cron/purge-users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyCronAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized cron request' });
    }

    try {
      const expiredUsers = await query<{ id: string }>(
        `SELECT id FROM users
         WHERE deleted_at IS NOT NULL AND purge_after < NOW()
         LIMIT 100`,
        [],
        true
      );

      let purgedCount = 0;
      for (const row of expiredUsers.rows) {
        await query(
          `UPDATE users
           SET email = 'anon_' || gen_random_uuid() || '@deleted.invalid',
               password_hash = '!deleted_' || gen_random_uuid(),
               status = 'locked',
               purge_after = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [row.id],
          true
        );
        purgedCount++;
      }

      return reply.status(200).send({
        success: true,
        purgedCount,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      process.stderr.write(`[Cron Error] User purge run failed: ${err.message}\n`);
      return reply.status(500).send({ error: 'User purge execution failed' });
    }
  });
}


