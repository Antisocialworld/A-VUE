import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAdmin } from '../env.js';
import { writerPool } from '../lib/db.js';
import { getMovieDetails } from '../lib/tmdb.js';
import { getSessionUser, UnauthorizedError } from '../lib/session.js';

const MAX_TICKET_TITLE_LOOKUPS = 25;
const TICKET_TITLE_LOOKUP_TIMEOUT_MS = 1500;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveTicketMovieTitles(
  movieIds: Array<string | number>,
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(
    new Set(movieIds.map((id) => String(id)).filter((id) => id.length > 0)),
  );
  const idsToLookup = uniqueIds.slice(0, MAX_TICKET_TITLE_LOOKUPS);
  const titles = new Map<string, string>();

  await Promise.all(
    idsToLookup.map(async (idStr) => {
      const numericId = Number(idStr);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        process.stderr.write(
          `[Tickets] movie_title_lookup movie_id=${idStr} reason=invalid_id\n`,
        );
        return;
      }

      try {
        const result = await withTimeout(
          getMovieDetails(numericId),
          TICKET_TITLE_LOOKUP_TIMEOUT_MS,
        );
        const title = result?.movie?.title;
        if (typeof title === 'string' && title.length > 0) {
          titles.set(idStr, title);
          return;
        }

        process.stderr.write(
          `[Tickets] movie_title_lookup movie_id=${idStr} reason=not_found\n`,
        );
      } catch (err: any) {
        const reason =
          err?.message === 'timeout'
            ? 'timeout'
            : err?.message === 'TMDB_UNAVAILABLE'
              ? 'tmdb_unavailable'
              : 'error';
        process.stderr.write(
          `[Tickets] movie_title_lookup movie_id=${idStr} reason=${reason}\n`,
        );
      }
    }),
  );

  return titles;
}

export async function ticketRoutes(fastify: FastifyInstance) {
  /**
   * GET /tickets
   * Returns tickets for authenticated user.
   * Only the SHA-256 hash is stored in DB; does NOT return a QR reference (Task 4a).
   */
  fastify.get('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const pool = writerPool;
    const result = await pool.query(
      `SELECT t.id, t.booking_id, t.status, t.created_at, t.used_at,
              b.showtime_id,
              s.movie_id, s.starts_at,
              COALESCE(st."row", st.row_label) as row,
              COALESCE(st."number", st.seat_number) as number,
              c.name as cinema_name,
              COALESCE(h.name, sc.name) as hall_name
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       JOIN showtimes s ON s.id = b.showtime_id
       JOIN seats st ON st.id = b.seat_id
       LEFT JOIN screens sc ON sc.id = s.screen_id
       LEFT JOIN halls h ON h.id = s.hall_id
       JOIN cinemas c ON c.id = COALESCE(h.cinema_id, sc.cinema_id)
       WHERE t.user_id = $1
       ORDER BY s.starts_at DESC`,
      [user.id]
    );

    const movieTitleMap = await resolveTicketMovieTitles(
      result.rows.map((row: any) => row.movie_id),
    );

    const tickets = result.rows.map((row: any) => {
      const movieTitle = movieTitleMap.get(String(row.movie_id));
      return {
        id: row.id,
        bookingId: row.booking_id,
        showtimeId: row.showtime_id,
        movieId: row.movie_id,
        ...(movieTitle ? { movieTitle } : {}),
        cinemaName: row.cinema_name,
        hallName: row.hall_name,
        row: row.row,
        number: Number(row.number),
        startsAt: new Date(row.starts_at).toISOString(),
        status: row.status,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });

    return reply.status(200).send({ tickets });
  });

  /**
   * POST /tickets/qr
   * Generates a fresh 256-bit crypto.randomBytes reference once.
   * Ticket id is passed in the JSON body, never in the URL.
   * Atomically replaces qr_hash in DB in one statement.
   * Owner only (Task 4a).
   */
  fastify.post('/tickets/qr', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const body = request.body as { ticketId?: string };
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : '';

    if (!ticketId) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A ticket id is required.',
          requestId: request.id,
        },
      });
    }

    // Fresh 256-bit opaque reference
    const freshReference = crypto.randomBytes(32).toString('hex');
    const freshHash = crypto.createHash('sha256').update(freshReference).digest('hex');

    const pool = writerPool;
    // Atomically replace qr_hash in one statement for ticket owner only
    const updateRes = await pool.query(
      `UPDATE tickets
       SET qr_hash = $1
       WHERE id = $2 AND user_id = $3 AND status = 'active'
       RETURNING id, status`,
      [freshHash, ticketId, user.id]
    );

    if (updateRes.rows.length === 0) {
      return reply.status(404).send({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Active ticket not found or you are not the owner.',
          requestId: request.id,
        },
      });
    }

    // Return the reference once (never stored in plaintext on server)
    return reply.status(200).send({
      ticketId,
      qrReference: freshReference,
    });
  });

  /**
   * POST /tickets/verify
   * Gatekeeper / admin verification endpoint.
   * Reference passed in BODY (never in URL or logs).
   * Atomically marks active ticket as used via UPDATE ... RETURNING (Task 4b, Task 5).
   */
  fastify.post('/tickets/verify', async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Task 5: Gatekeeper / Admin authorization guard
    if (!isAdmin(user.email)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Admin gatekeeper authorization required to verify tickets.',
          requestId: request.id,
        },
      });
    }

    const body = request.body as { reference?: string };
    const reference = body?.reference;

    if (!reference || typeof reference !== 'string' || reference.trim().length === 0) {
      return reply.status(400).send({
        valid: false,
        status: 'invalid_request',
        message: 'Missing ticket reference in request body.',
      });
    }

    // Compute SHA-256 (Rule 02: SHA-256 only for QR reference lookup)
    // Never log raw reference
    const qrHash = crypto.createHash('sha256').update(reference.trim()).digest('hex');

    const pool = writerPool;

    // First scan marks ticket used atomically
    const updateRes = await pool.query(
      `UPDATE tickets
       SET status = 'used', used_at = NOW()
       WHERE qr_hash = $1 AND status = 'active'
       RETURNING id, booking_id, status, used_at`,
      [qrHash]
    );

    if (updateRes.rows.length > 0) {
      const row = updateRes.rows[0];
      return reply.status(200).send({
        valid: true,
        status: 'used',
        ticketId: row.id,
        bookingId: row.booking_id,
        usedAt: row.used_at,
        message: 'Ticket validated and marked as used successfully.',
      });
    }

    // If no row updated, check if already used or cancelled or unknown
    const checkRes = await pool.query(
      `SELECT id, status, used_at FROM tickets WHERE qr_hash = $1`,
      [qrHash]
    );

    if (checkRes.rows.length === 0) {
      return reply.status(404).send({
        valid: false,
        status: 'not_found',
        message: 'Invalid or unknown ticket reference.',
      });
    }

    const ticket = checkRes.rows[0];
    if (ticket.status === 'used') {
      return reply.status(200).send({
        valid: false,
        status: 'already_used',
        ticketId: ticket.id,
        usedAt: ticket.used_at,
        message: 'Ticket has already been used.',
      });
    }

    return reply.status(200).send({
      valid: false,
      status: ticket.status,
      ticketId: ticket.id,
      message: `Ticket is not active (current status: ${ticket.status}).`,
    });
  });
}
