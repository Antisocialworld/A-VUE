/**
 * Read-only live facts for Ask A VUE.
 *
 * Fixed, parameterised SQL only. No user text reaches this module, no SQL is built
 * from strings, and every query has a short client-side statement deadline so a
 * slow database cannot hold a chat request open. Money stays in integer kobo until
 * it is rendered by formatKoboToNaira().
 */

import type { QueryConfig, QueryResult, QueryResultRow } from 'pg';
import { readerPool } from '../db.js';

/** Client-side deadline; avoids SET statement_timeout, which PgBouncer forbids. */
export const LIVE_FACTS_TIMEOUT_MS = 3000;

export interface CinemaPriceRange {
  cinemaName: string;
  lowKobo: number;
  highKobo: number;
}

export interface CinemaShowtime {
  cinemaName: string;
  showDate: string;
  time: string;
}

type TimedQuery = QueryConfig & { query_timeout: number };

async function readRows<T extends QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
  const result: QueryResult<T> = await readerPool.query<T>({
    text,
    values,
    query_timeout: LIVE_FACTS_TIMEOUT_MS,
  } as TimedQuery);
  return result.rows ?? [];
}

/** Integer kobo to naira text. Whole naira has no decimals; otherwise two decimals. */
export function formatKoboToNaira(amountKobo: number): string {
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) return '';
  const kobo = BigInt(amountKobo);
  const naira = kobo / 100n;
  const remainder = kobo % 100n;
  const whole = naira.toLocaleString('en-US');
  return remainder === 0n ? `₦${whole}` : `₦${whole}.${remainder.toString().padStart(2, '0')}`;
}

interface PriceRow extends QueryResultRow {
  cinema_name: string;
  low_kobo: string | number | null;
  high_kobo: string | number | null;
}

/**
 * Lowest and highest configured non-NULL screen price per cinema. A NULL price
 * means "not set", so a cinema with no priced screens is simply absent.
 */
export async function readCinemaPriceRanges(): Promise<CinemaPriceRange[]> {
  const rows = await readRows<PriceRow>(
    `SELECT c.name AS cinema_name,
            MIN(s.price_kobo) AS low_kobo,
            MAX(s.price_kobo) AS high_kobo
     FROM cinemas c
     JOIN screens s ON s.cinema_id = c.id
     WHERE s.price_kobo IS NOT NULL
     GROUP BY c.id, c.name
     ORDER BY c.name ASC`,
    [],
  );

  return rows
    .map((row) => ({
      cinemaName: String(row.cinema_name),
      lowKobo: Number(row.low_kobo),
      highKobo: Number(row.high_kobo),
    }))
    .filter(
      (row) =>
        Number.isSafeInteger(row.lowKobo) &&
        Number.isSafeInteger(row.highKobo) &&
        row.lowKobo > 0 &&
        row.highKobo >= row.lowKobo,
    );
}

interface ShowtimeRow extends QueryResultRow {
  cinema_name: string;
  show_date: string;
  show_time: string;
}

/**
 * Upcoming showtimes for one TMDB id, next two Lagos calendar days, each with its
 * Lagos date and local time. At most `limitPerCinema` per cinema. An empty list
 * means no rows yet, not that the film has no showtimes.
 */
export async function readUpcomingShowtimes(
  tmdbId: number,
  limitPerCinema = 3,
): Promise<CinemaShowtime[]> {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return [];
  if (!Number.isSafeInteger(limitPerCinema) || limitPerCinema <= 0) return [];

  const rows = await readRows<ShowtimeRow>(
    `WITH upcoming AS (
       SELECT c.name AS cinema_name,
              to_char(st.starts_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS show_date,
              to_char(st.starts_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') AS show_time,
              ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY st.starts_at ASC) AS slot
       FROM showtimes st
       LEFT JOIN screens sc ON sc.id = COALESCE(st.hall_id, st.screen_id)
       LEFT JOIN halls h ON h.id = COALESCE(st.hall_id, st.screen_id)
       JOIN cinemas c ON c.id = COALESCE(h.cinema_id, sc.cinema_id)
       WHERE st.movie_id = $1
         AND st.cancelled_at IS NULL
         AND st.starts_at >= NOW()
         AND (st.starts_at AT TIME ZONE 'Africa/Lagos') < ((NOW() AT TIME ZONE 'Africa/Lagos')::date + 2)
     )
     SELECT DISTINCT cinema_name, show_date, show_time
     FROM upcoming
     WHERE slot <= $2
     ORDER BY show_date ASC, cinema_name ASC, show_time ASC`,
    [String(tmdbId), limitPerCinema],
  );

  return rows
    .map((row) => ({
      cinemaName: String(row.cinema_name),
      showDate: String(row.show_date),
      time: String(row.show_time),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.showDate) && /^\d{2}:\d{2}$/.test(row.time));
}
