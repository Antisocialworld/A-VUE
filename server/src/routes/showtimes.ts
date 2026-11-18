import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, isAdmin } from '../env.js';
import { writerPool } from '../lib/db.js';
import { getSeatMap, holdSeats, releaseSeats } from '../lib/holds.js';
import { cancelShowtimeAndRefund } from '../lib/jobs.js';
import { createPgOnDemandStore, ensureOnDemandShowtimes } from '../lib/onDemandEnsure.js';
import { holdRateLimit, onDemandRateLimit, searchRateLimit } from '../lib/rateLimit.js';
import { getSessionUser, UnauthorizedError } from '../lib/session.js';
import { getMovieDetails } from '../lib/tmdb.js';
import { checkInWaitingRoom, getWaitingRoomStatus } from '../lib/waitingRoom.js';
import {
  ensureMovieShowtimesParamsSchema,
  holdSeatsBodySchema,
  releaseHoldsBodySchema,
} from '../schemas/cinema.js';

export async function showtimeRoutes(fastify: FastifyInstance) {
  /**
   * GET /movies/:id/showtimes
   * Fetches showtimes for a TMDB movie grouped by cinema.
   */
  fastify.get('/movies/:id/showtimes', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: movieId } = request.params as { id: string };

    const pool = writerPool;
    const result = await pool.query(
      `SELECT s.id, s.movie_id, s.screen_id, s.hall_id, s.starts_at, s.price_kobo, s.cancelled_at,
              c.id as cinema_id, c.name as cinema_name, c.city,
              COALESCE(h.name, sc.name) as hall_name
       FROM showtimes s
       LEFT JOIN screens sc ON sc.id = COALESCE(s.hall_id, s.screen_id)
       LEFT JOIN halls h ON h.id = COALESCE(s.hall_id, s.screen_id)
       JOIN cinemas c ON c.id = COALESCE(h.cinema_id, sc.cinema_id)
       WHERE s.movie_id = $1 AND s.cancelled_at IS NULL AND s.starts_at > NOW()
       ORDER BY c.name ASC, s.starts_at ASC`,
      [movieId]
    );

    const showtimes = result.rows.map((row: any) => ({
      id: row.id,
      movieId: row.movie_id,
      cinemaId: row.cinema_id,
      cinemaName: row.cinema_name,
      city: row.city,
      hallId: row.hall_id || row.screen_id,
      hallName: row.hall_name,
      startsAt: new Date(row.starts_at).toISOString(),
      priceKobo: Number(row.price_kobo),
      isCancelled: Boolean(row.cancelled_at),
    }));

    return reply.status(200).send({
      movieId,
      showtimes,
    });
  });

  /**
   * POST /movies/:id/showtimes/ensure
   * Idempotently makes sure the movie has on-demand showtimes for the Lagos horizon.
   *
   * - Auth required; dual rate limit (user AND IP).
   * - Per-movie advisory lock + one transaction; concurrent calls serialise.
   * - Screens and prices are loaded from the DB; no hardcoded halls or prices.
   * - Occupied slots include cancelled showtimes (they still own (screen_id, starts_at)).
   * - Always 200 with { created, reason? }: "nothing to add" is a normal outcome.
   *
   * Logs movie id, counts and reason only. Never the requesting user.
   */
  fastify.post('/movies/:id/showtimes/ensure', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const allowed = await onDemandRateLimit(request, reply, user.id);
    if (!allowed) return;

    const parsedParams = ensureMovieShowtimesParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid movie id.',
          requestId: request.id,
        },
      });
    }

    const movieId = parsedParams.data.id;

    // Eligibility needs the release date. TMDB is the only source for it.
    let releaseDate: string | null = null;
    try {
      const details = await getMovieDetails(movieId);
      if (!details) {
        return reply.status(200).send({ created: 0, reason: 'NOT_ELIGIBLE' });
      }
      releaseDate = details.movie.releaseDate;
    } catch {
      return reply.status(200).send({ created: 0, reason: 'TMDB_UNAVAILABLE' });
    }

    const client = await writerPool.connect().catch(() => null);
    if (!client) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unable to prepare showtimes. Please retry.',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await ensureOnDemandShowtimes({
        movieId,
        releaseDate,
        now: new Date(),
        caps: {
          horizonDays: env.ON_DEMAND_DAYS,
          minLeadMinutes: env.ON_DEMAND_MIN_LEAD_MINUTES,
          slotsPerMoviePerDay: env.ON_DEMAND_SLOTS_PER_MOVIE_PER_DAY,
          maxShowtimesPerMovie: env.ON_DEMAND_MAX_SHOWTIMES_PER_MOVIE,
          maxNewMoviesPerDay: env.ON_DEMAND_MAX_NEW_MOVIES_PER_DAY,
          maxActiveShowtimes: env.ON_DEMAND_MAX_ACTIVE_SHOWTIMES,
        },
        store: createPgOnDemandStore(client),
      });

      // Privacy: movie id, counts and reason only. No user id, no search text.
      request.log.info(
        { movieId, created: result.created, reason: result.reason ?? null },
        'on_demand_showtimes_ensure',
      );

      return reply.status(200).send(
        result.reason
          ? { created: result.created, reason: result.reason }
          : { created: result.created },
      );
    } catch (err: any) {
      request.log.error(
        { movieId, err: err?.message ?? 'unknown' },
        'on_demand_showtimes_ensure_failed',
      );
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unable to prepare showtimes. Please retry.',
          requestId: request.id,
        },
      });
    } finally {
      client.release();
    }
  });

  /**
   * GET /showtimes/:id/seats
   * Returns seat map with state (available | held | sold).
   * Cached in Redis for 2s. Polling ready. Auth required.
   */
  fastify.get('/showtimes/:id/seats', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const allowed = await searchRateLimit(request, reply, user.id);
    if (!allowed) return;

    const { id: showtimeId } = request.params as { id: string };

    try {
      const seatMap = await getSeatMap(showtimeId);
      return reply.status(200).send(seatMap);
    } catch (err: any) {
      if (err.message === 'SHOWTIME_NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Showtime not found',
            requestId: request.id,
          },
        });
      }
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unable to load seat map. Please retry.',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * GET /showtimes/:id/waiting-room
   * Checks or joins the showtime waiting room.
   */
  fastify.get('/showtimes/:id/waiting-room', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const { id: showtimeId } = request.params as { id: string };
    const status = await getWaitingRoomStatus(showtimeId, user.id);
    return reply.status(200).send(status);
  });

  /**
   * POST /showtimes/:id/holds
   * Atomic multi-seat hold (max 6 seats).
   * Verifies waiting room pass if room is active.
   * Rate limited per user AND per IP. Fail closed on Redis failure.
   */
  fastify.post('/showtimes/:id/holds', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const allowed = await holdRateLimit(request, reply, user.id);
    if (!allowed) return;

    const { id: showtimeId } = request.params as { id: string };
    const parsed = holdSeatsBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid hold request. Max 6 seats allowed.',
          requestId: request.id,
        },
      });
    }

    const { seatIds } = parsed.data;

    // Check waiting room admission via atomic check-in (Task B)
    try {
      const roomStatus = await checkInWaitingRoom(showtimeId, user.id);
      if (roomStatus.status !== 'admitted') {
        return reply.status(429).send({
          error: {
            code: 'WAITING_ROOM_REQUIRED',
            message: 'High traffic. Please join the waiting room first.',
            requestId: request.id,
          },
        });
      }
    } catch {
      // Fail closed on Redis error
      return reply.status(429).send({
        error: {
          code: 'WAITING_ROOM_REQUIRED',
          message: 'High traffic. Please join the waiting room first.',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await holdSeats(showtimeId, seatIds, user.id);

      if (result.status === 'conflict_held' || result.status === 'conflict_sold') {
        return reply.status(409).send({
          error: {
            code: 'SEAT_UNAVAILABLE',
            message: 'One or more selected seats are no longer available.',
            requestId: request.id,
          },
        });
      }

      return reply.status(200).send({
        success: true,
        showtimeId,
        seatIds,
        expiresAt: result.expiresAt,
        holdTtlSeconds: 600,
      });
    } catch (err: any) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Seat hold service temporarily unavailable. Please retry.',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * DELETE /showtimes/:id/holds
   * Owner-only compare-and-delete release.
   */
  fastify.delete('/showtimes/:id/holds', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const { id: showtimeId } = request.params as { id: string };
    const parsed = releaseHoldsBodySchema.safeParse(request.body || {});
    const seatIds = parsed.success ? parsed.data.seatIds : undefined;

    try {
      const released = await releaseSeats(showtimeId, seatIds, user.id);
      return reply.status(200).send({
        success: true,
        releasedCount: released,
      });
    } catch (err: any) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unable to release seats. Please retry.',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * POST /showtimes/:id/cancel
   * Cancels a showtime and triggers automated idempotent refunds to ledger.
   * Admin only (Task 5).
   */
  fastify.post('/showtimes/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    // Task 5: Admin authorization guard
    if (!isAdmin(user.email)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required for this action.',
          requestId: request.id,
        },
      });
    }

    const { id: showtimeId } = request.params as { id: string };

    try {
      const result = await cancelShowtimeAndRefund(showtimeId);
      return reply.status(200).send({
        success: true,
        showtimeId,
        refundedBookings: result.refundedCount,
        totalKoboRefunded: result.totalKoboRefunded.toString(),
      });
    } catch (err: any) {
      return reply.status(500).send({
        error: {
          code: 'CANCELLATION_FAILED',
          message: 'Failed to cancel showtime.',
          requestId: request.id,
        },
      });
    }
  });
}

