import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getTmdbToken } from '../env.js';
import { getSessionUser } from '../lib/session.js';
import { getMovieDetails, getNowPlayingMovies } from '../lib/tmdb.js';
import { posterRateLimit } from '../lib/rateLimit.js';
import {
  movieDetailParamsSchema,
  moviesListQuerySchema,
  posterParamsSchema,
} from '../schemas/movies.js';

const MAX_POSTER_BYTES = 1024 * 1024; // 1 MB limit per Task 2
const POSTER_HOST = 'https://image.tmdb.org/t/p';

/**
 * Authentication preHandler for protected movie routes.
 * Never leaks token or session internals on failure.
 */
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await getSessionUser(request);
  } catch {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to access movie endpoints.',
        requestId: request.id,
      },
    });
  }
}

export async function movieRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. GET /movies — Authenticated list with pagination (page 1 to 5)
  fastify.get(
    '/movies',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Token check: if missing, return 503 generic message without leaking token name (Task 1)
      if (!getTmdbToken()) {
        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Movie service is temporarily unavailable. Please try again later.',
            requestId: request.id,
          },
        });
      }

      const parseQuery = moviesListQuerySchema.safeParse(request.query);
      if (!parseQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid pagination query parameters.',
            requestId: request.id,
          },
        });
      }

      try {
        const result = await getNowPlayingMovies(parseQuery.data.page);
        return reply.status(200).send(result);
      } catch (err: any) {
        request.log.error({ requestId: request.id, err: err.message }, 'Failed to fetch movies list');
        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Movie service is temporarily unavailable. Please try again later.',
            requestId: request.id,
          },
        });
      }
    },
  );

  // 2. GET /movies/:id — Authenticated movie details
  fastify.get(
    '/movies/:id',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Token check: if missing, return 503 generic message
      if (!getTmdbToken()) {
        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Movie service is temporarily unavailable. Please try again later.',
            requestId: request.id,
          },
        });
      }

      const parseParams = movieDetailParamsSchema.safeParse(request.params);
      if (!parseParams.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid movie ID parameter. Must be a positive integer.',
            requestId: request.id,
          },
        });
      }

      try {
        const detailResult = await getMovieDetails(parseParams.data.id);
        if (!detailResult) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Movie not found.',
              requestId: request.id,
            },
          });
        }
        return reply.status(200).send({ movie: detailResult.movie, stale: detailResult.stale ?? false });
      } catch (err: any) {
        request.log.error({ requestId: request.id, err: err.message }, 'Failed to fetch movie details');
        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Movie service is temporarily unavailable. Please try again later.',
            requestId: request.id,
          },
        });
      }
    },
  );

  // 3. GET /movies/poster/:size/:file — SSRF-guarded image proxy
  // Strict checks: size in ['w185', 'w342', 'w500'], file matches ^[A-Za-z0-9_-]{5,64}\.jpg$, max 1MB
  fastify.get(
    '/movies/poster/:size/:file',
    { preHandler: [posterRateLimit] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseParams = posterParamsSchema.safeParse(request.params);
      if (!parseParams.success) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid poster size or filename.',
            requestId: request.id,
          },
        });
      }

      const { size, file } = parseParams.data;
      const targetUrl = `${POSTER_HOST}/${size}/${file}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
        });

        if (response.status === 404) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Poster image not found.',
              requestId: request.id,
            },
          });
        }

        if (!response.ok) {
          return reply.status(502).send({
            error: {
              code: 'BAD_GATEWAY',
              message: 'Failed to retrieve poster from upstream CDN.',
              requestId: request.id,
            },
          });
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_POSTER_BYTES) {
          return reply.status(413).send({
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Poster image exceeds maximum allowed size (1 MB).',
              requestId: request.id,
            },
          });
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > MAX_POSTER_BYTES) {
          return reply.status(413).send({
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Poster image exceeds maximum allowed size (1 MB).',
              requestId: request.id,
            },
          });
        }

        return reply
          .header('Cache-Control', 'public, max-age=86400')
          .type('image/jpeg')
          .send(buffer);
      } catch (err: any) {
        request.log.error({ requestId: request.id, err: err.message }, 'Poster proxy error');
        return reply.status(502).send({
          error: {
            code: 'BAD_GATEWAY',
            message: 'Upstream poster request failed.',
            requestId: request.id,
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}

