import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { checkDbHealth } from '../lib/db.js';
import { checkRedisHealth } from '../lib/redis.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // Liveness check
  fastify.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Deep readiness check: checks DB and Redis reachable
  // Rule 02: /health/deep and logs never print URLs, hosts or passwords.
  fastify.get('/health/deep', async (_req: FastifyRequest, reply: FastifyReply) => {
    const [dbOk, redisOk] = await Promise.all([checkDbHealth(), checkRedisHealth()]);

    const isHealthy = dbOk && redisOk;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? 'healthy' : 'unhealthy',
      database: dbOk ? 'reachable' : 'unreachable',
      redis: redisOk ? 'reachable' : 'unreachable',
      timestamp: new Date().toISOString(),
    });
  });
}

