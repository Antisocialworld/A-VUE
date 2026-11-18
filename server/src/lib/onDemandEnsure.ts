/**
 * Transactional on-demand showtime creation.
 *
 * The arithmetic lives in onDemandShowtimes.ts (pure, deterministic).
 * This module owns the database transaction, the per-movie advisory lock,
 * the configured caps, and the conflict-safe insert.
 *
 * Privacy: never log the requesting user. Callers may log movie id, counts and reason only.
 */

import type { PoolClient } from 'pg';
import {
  getLagosHorizonDays,
  isMovieEligibleForHorizon,
  planOnDemandShowtimes,
  type ExistingShowtimeItem,
  type PlannedShowtime,
  type ScreenDefinition,
} from './onDemandShowtimes.js';

export type EnsureReason =
  | 'NOT_ELIGIBLE'
  | 'TMDB_UNAVAILABLE'
  | 'NO_CAPACITY'
  | 'CAP_REACHED';

export interface EnsureResult {
  created: number;
  reason?: EnsureReason;
}

export interface EnsureCaps {
  horizonDays: number;
  minLeadMinutes: number;
  slotsPerMoviePerDay: number;
  maxShowtimesPerMovie: number;
  maxNewMoviesPerDay: number;
  maxActiveShowtimes: number;
}

export interface ListOccupiedParams {
  screenIds: string[];
  from: Date;
  throughDate: string; // YYYY-MM-DD, last Lagos horizon day
}

export interface OnDemandStore {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  lockMovie(movieId: number): Promise<void>;
  countActiveForMovie(movieId: number, now: Date): Promise<number>;
  countActive(now: Date): Promise<number>;
  countNewMoviesForDay(lagosDate: string, excludeMovieId: number): Promise<number>;
  listScreens(): Promise<ScreenDefinition[]>;
  listOccupied(params: ListOccupiedParams): Promise<ExistingShowtimeItem[]>;
  insertShowtimes(planned: PlannedShowtime[]): Promise<number>;
}

export interface EnsureOnDemandParams {
  movieId: number;
  releaseDate: string | null | undefined;
  now: Date;
  caps: EnsureCaps;
  store: OnDemandStore;
}

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/**
 * Creates showtimes for one movie in one transaction.
 * Two concurrent calls for the same movie serialise on the advisory lock; the
 * second one sees the first one's active rows and returns created: 0.
 */
export async function ensureOnDemandShowtimes(params: EnsureOnDemandParams): Promise<EnsureResult> {
  const { movieId, releaseDate, now, caps, store } = params;

  if (!isMovieEligibleForHorizon(releaseDate, now, caps.horizonDays)) {
    return { created: 0, reason: 'NOT_ELIGIBLE' };
  }

  await store.begin();
  try {
    // Keyed on the movie id: all ensure calls for one movie run one at a time.
    await store.lockMovie(movieId);

    // Re-count under the lock. Any active showtime for this movie means the
    // ensure request is already satisfied (idempotent).
    const activeForMovie = await store.countActiveForMovie(movieId, now);
    if (activeForMovie > 0) {
      await store.commit();
      return { created: 0 };
    }

    const activeTotal = await store.countActive(now);
    if (activeTotal >= caps.maxActiveShowtimes) {
      await store.commit();
      return { created: 0, reason: 'CAP_REACHED' };
    }

    const lagosDate = getLagosHorizonDays(now, 1)[0]?.dateStr;
    if (!lagosDate) {
      await store.commit();
      return { created: 0, reason: 'NO_CAPACITY' };
    }

    const newMoviesToday = await store.countNewMoviesForDay(lagosDate, movieId);
    if (newMoviesToday >= caps.maxNewMoviesPerDay) {
      await store.commit();
      return { created: 0, reason: 'CAP_REACHED' };
    }

    const screens = await store.listScreens();
    if (screens.length === 0) {
      await store.commit();
      return { created: 0, reason: 'NO_CAPACITY' };
    }

    const horizon = getLagosHorizonDays(now, caps.horizonDays);
    const lastHorizonDate = horizon[horizon.length - 1]?.dateStr;
    if (!lastHorizonDate) {
      await store.commit();
      return { created: 0, reason: 'NO_CAPACITY' };
    }

    // Occupied rows deliberately include cancelled showtimes: they still own
    // the (screen_id, starts_at) unique slot.
    const occupied = await store.listOccupied({
      screenIds: screens.map((screen) => screen.id),
      from: new Date(now.getTime() - THREE_HOURS_MS),
      throughDate: lastHorizonDate,
    });

    const planned = planOnDemandShowtimes({
      movieId,
      releaseDate,
      now,
      existingShowtimes: occupied,
      horizonDays: caps.horizonDays,
      minLeadMinutes: caps.minLeadMinutes,
      slotsPerMoviePerDay: caps.slotsPerMoviePerDay,
      maxShowtimesPerMovie: caps.maxShowtimesPerMovie,
      existingMovieShowtimesCount: 0,
      screens,
    });

    if (planned.length === 0) {
      await store.commit();
      return { created: 0, reason: 'NO_CAPACITY' };
    }

    const remainingActive = caps.maxActiveShowtimes - activeTotal;
    const limited = planned.slice(0, remainingActive);
    if (limited.length === 0) {
      await store.commit();
      return { created: 0, reason: 'CAP_REACHED' };
    }

    const created = await store.insertShowtimes(limited);
    await store.commit();

    if (created === 0) {
      // Every planned slot lost the unique conflict race.
      return { created: 0, reason: 'NO_CAPACITY' };
    }

    return { created };
  } catch (err) {
    await store.rollback().catch(() => {});
    throw err;
  }
}

interface QueryResultLike {
  rows: any[];
  rowCount: number | null;
}

/**
 * PostgreSQL-backed store. The caller supplies a dedicated PoolClient so the
 * whole operation stays inside one transaction.
 */
export function createPgOnDemandStore(client: PoolClient): OnDemandStore {
  return {
    async begin() {
      await client.query('BEGIN');
    },

    async commit() {
      await client.query('COMMIT');
    },

    async rollback() {
      await client.query('ROLLBACK');
    },

    async lockMovie(movieId: number) {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [movieId]);
    },

    async countActiveForMovie(movieId: number, now: Date) {
      const result: QueryResultLike = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM showtimes
         WHERE movie_id = $1
           AND cancelled_at IS NULL
           AND starts_at > $2::timestamptz`,
        [String(movieId), now.toISOString()],
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async countActive(now: Date) {
      const result: QueryResultLike = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM showtimes
         WHERE cancelled_at IS NULL
           AND starts_at > $1::timestamptz`,
        [now.toISOString()],
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async countNewMoviesForDay(lagosDate: string, excludeMovieId: number) {
      const result: QueryResultLike = await client.query(
        `SELECT COUNT(DISTINCT movie_id)::int AS count
         FROM showtimes
         WHERE source = 'on_demand'
           AND (created_at AT TIME ZONE 'Africa/Lagos')::date = $1::date
           AND movie_id <> $2`,
        [lagosDate, String(excludeMovieId)],
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async listScreens() {
      // screens.price_kobo is authoritative (migration 007). A NULL price means
      // the screen has no configured price, so it is excluded rather than given
      // an invented price.
      // Free/on-demand screens only (is_seeded = false); seeded screens keep fixed seed rows.
      const result: QueryResultLike = await client.query(
        `SELECT id, cinema_id, name, price_kobo
         FROM screens
         WHERE price_kobo IS NOT NULL AND is_seeded = false
         ORDER BY id ASC`,
      );

      return result.rows.map((row) => ({
        id: String(row.id),
        cinemaId: String(row.cinema_id),
        name: String(row.name),
        priceKobo: Number(row.price_kobo),
      }));
    },

    async listOccupied({ screenIds, from, throughDate }: ListOccupiedParams) {
      // No cancelled_at filter on purpose: cancelled rows still occupy the slot.
      const result: QueryResultLike = await client.query(
        `SELECT screen_id, starts_at, cancelled_at
         FROM showtimes
         WHERE screen_id = ANY($1::uuid[])
           AND starts_at >= $2::timestamptz
           AND starts_at < ($3::date + INTERVAL '1 day' + INTERVAL '3 hours')`,
        [screenIds, from.toISOString(), throughDate],
      );

      return result.rows.map((row) => ({
        screenId: String(row.screen_id),
        startsAt: new Date(row.starts_at).toISOString(),
        cancelled: Boolean(row.cancelled_at),
      }));
    },

    async insertShowtimes(planned: PlannedShowtime[]) {
      if (planned.length === 0) {
        return 0;
      }

      const values: unknown[] = [];
      const tuples = planned.map((item, index) => {
        const base = index * 4;
        values.push(item.movieId, item.screenId, item.startsAt, item.priceKobo);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'on_demand')`;
      });

      // Only inserted rows are returned: ON CONFLICT DO NOTHING rows are absent.
      const result: QueryResultLike = await client.query(
        `INSERT INTO showtimes (movie_id, screen_id, starts_at, price_kobo, source)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (screen_id, starts_at) DO NOTHING
         RETURNING id`,
        values,
      );

      return result.rows.length;
    },
  };
}
