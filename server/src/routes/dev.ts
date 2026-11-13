/**
 * DEV-ONLY PROOF ROUTE
 * Clearly marked for removal before production release.
 * Task B.4: Hashes a sample value with Argon2id and returns execution timing only.
 * Leaks no hash values, salts, or passwords.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashArgon2id } from '../lib/argon2.js';
import { env } from '../env.js';

export async function devRoutes(fastify: FastifyInstance): Promise<void> {
  // DEV-ONLY: Remove before production deployment
  fastify.get('/dev/argon2-proof', async (_req: FastifyRequest, reply: FastifyReply) => {
    if (env.NODE_ENV === 'production') {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const start = performance.now();
    await hashArgon2id('benchmark-sample-entropy');
    const elapsedMs = Math.round(performance.now() - start);

    return reply.status(200).send({
      proof: 'Argon2id execution benchmark',
      elapsedMs,
      timeCost: env.ARGON2_TIME_COST,
      memoryCost: env.ARGON2_MEMORY_COST,
      notice: 'DEV ONLY — Clearly marked for removal prior to production release',
    });
  });
}

