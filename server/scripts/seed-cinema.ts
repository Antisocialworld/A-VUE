/**
 * A VUE Cinema & Showtimes Seed Script
 * Populates cinemas, halls, screens, seats, and showtimes for the A VUE platform.
 * Rule 03 (Database), Rule 04 (Traffic & Payments)
 *
 * Guarantees:
 * - Fixed deterministic IDs and data.
 * - Idempotent and safe to re-run: ON CONFLICT DO NOTHING and WHERE NOT EXISTS guards.
 * - Executes in a single database transaction (BEGIN / COMMIT / ROLLBACK).
 * - Never prints connection strings or secrets.
 * - Populates both `screens` and `halls` for API compatibility.
 * - Populates `seats` with both migration 001 and migration 002 column sets.
 * - Requires migration 007: writes screens.price_kobo for every SEED_HALLS entry.
 * - Generates showtimes for the next 8 days at 13:00, 16:30, and 20:00 Africa/Lagos time (+01:00).
 * - Seeds the first SEED_MOVIE_COUNT loaded movie ids on the first SEED_SCREEN_COUNT
 *   screens sorted by id ascending. The remaining screen gets no seeded showtimes.
 * - Rotates movies deterministically across 9 cells per day (3 screens x 3 slots)
 *   with movie = movieIds[(slotIdx + screenIdx + dayIdx) % movieIds.length].
 * - Guards showtime inserts on (screen_id, starts_at) only, with no ON CONFLICT,
 *   so the script works both before and after migration 006 adds the unique index.
 * - Leaves `source` unset; migration 006 defaults it to 'seed'.
 * - Exit code 0 on success.
 */

import { writerPool } from '../src/lib/db.js';
import { getNowPlayingMovies } from '../src/lib/tmdb.js';
import {
  SEED_MOVIE_COUNT,
  buildSeedShowtimes,
  selectFirstScreensById,
} from '../src/lib/seedSchedule.js';

interface CinemaData {
  id: string;
  name: string;
  city: string;
  address: string;
}

interface HallData {
  id: string;
  cinemaId: string;
  name: string;
  totalSeats: number;
  priceKobo: number;
  rows: string[];
  seatsPerRow: number;
  accessibleSeats: { row: string; number: number }[];
}

// 1. Two Cinemas in Lagos (Fixed Deterministic UUIDs)
export const SEED_CINEMAS: CinemaData[] = [
  {
    id: 'a0000001-0000-4000-8000-000000000001',
    name: 'A VUE Cinema Victoria Island',
    city: 'Lagos',
    address: 'Plot 1415, Adetokunbo Ademola Street, Victoria Island, Lagos',
  },
  {
    id: 'a0000001-0000-4000-8000-000000000002',
    name: 'A VUE Cinema Ikeja City Mall',
    city: 'Lagos',
    address: 'Obafemi Awolowo Way, Alausa, Ikeja, Lagos',
  },
];

// Seating Configurations
const ROWS_80 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']; // 8 rows * 10 = 80 seats
const ROWS_50 = ['A', 'B', 'C', 'D', 'E']; // 5 rows * 10 = 50 seats (k6 load test)

// 2. Two Halls per Cinema (One 80-seat, One 50-seat, Different integer priceKobo)
export const SEED_HALLS: HallData[] = [
  // Cinema 1: Victoria Island
  {
    id: 'b0000001-0000-4000-8000-000000000001',
    cinemaId: SEED_CINEMAS[0].id,
    name: 'Screen 1 (Grand)',
    totalSeats: 80,
    priceKobo: 350000, // 3,500 NGN in integer kobo
    rows: ROWS_80,
    seatsPerRow: 10,
    accessibleSeats: [
      { row: 'A', number: 1 },
      { row: 'A', number: 2 },
    ],
  },
  {
    id: 'b0000001-0000-4000-8000-000000000002',
    cinemaId: SEED_CINEMAS[0].id,
    name: 'Screen 2 (VIP)',
    totalSeats: 50, // Exactly 50 seats for k6 load test
    priceKobo: 450000, // 4,500 NGN in integer kobo
    rows: ROWS_50,
    seatsPerRow: 10,
    accessibleSeats: [
      { row: 'A', number: 1 },
      { row: 'A', number: 2 },
    ],
  },
  // Cinema 2: Ikeja City Mall
  {
    id: 'b0000002-0000-4000-8000-000000000001',
    cinemaId: SEED_CINEMAS[1].id,
    name: 'Screen 1 (Main)',
    totalSeats: 80,
    priceKobo: 300000, // 3,000 NGN in integer kobo
    rows: ROWS_80,
    seatsPerRow: 10,
    accessibleSeats: [
      { row: 'A', number: 1 },
      { row: 'A', number: 2 },
    ],
  },
  {
    id: 'b0000002-0000-4000-8000-000000000002',
    cinemaId: SEED_CINEMAS[1].id,
    name: 'Screen 2 (Arena)',
    totalSeats: 50, // Exactly 50 seats for k6 load test
    priceKobo: 400000, // 4,000 NGN in integer kobo
    rows: ROWS_50,
    seatsPerRow: 10,
    accessibleSeats: [
      { row: 'A', number: 1 },
      { row: 'A', number: 2 },
    ],
  },
];

/**
 * Calculates calendar dates for the next 8 days in Africa/Lagos timezone (UTC+1).
 * Slots: 13:00, 16:30, 20:00 Africa/Lagos.
 */
export function getLagosScheduleSlots(
  daysCount = 8,
  now: Date = new Date(),
): { dateStr: string; times: string[] }[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now);
  const [baseYear, baseMonth, baseDay] = todayStr.split('-').map(Number);

  const schedule: { dateStr: string; times: string[] }[] = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay + i));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    schedule.push({
      dateStr: `${yyyy}-${mm}-${dd}`,
      times: ['13:00', '16:30', '20:00'],
    });
  }
  return schedule;
}

/**
 * Resolves movie IDs:
 * 1. Checks MOVIE_IDS environment variable.
 * 2. Attempts to query the existing backend Movies source (`getNowPlayingMovies`).
 * 3. Falls back to a deterministic curated list when running offline or without TMDB access.
 */
export async function resolveMovieIds(): Promise<{ movieIds: string[]; source: string }> {
  if (process.env.MOVIE_IDS && process.env.MOVIE_IDS.trim()) {
    const fromEnv = process.env.MOVIE_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromEnv.length > 0) {
      return { movieIds: fromEnv, source: 'process.env.MOVIE_IDS' };
    }
  }

  try {
    const res = await getNowPlayingMovies(1);
    if (res && Array.isArray(res.movies) && res.movies.length > 0) {
      const ids = res.movies.map((m) => String(m.id));
      return {
        movieIds: ids,
        source: `backend getNowPlayingMovies (${ids.length} movies loaded)`,
      };
    }
  } catch {
    // Expected when offline or when TMDB token is unconfigured
  }

  // Curated deterministic fallback list of popular TMDB movie IDs
  const fallbackList = ['550', '933260', '1022789', '533535', '693134', '823464'];
  return {
    movieIds: fallbackList,
    source: `default curated list (${fallbackList.length} movie IDs; set MOVIE_IDS or TMDB_ACCESS_TOKEN to override)`,
  };
}

/**
 * Executes the idempotent cinema seed operation inside a single transaction.
 */
export async function seedCinema(): Promise<void> {
  console.log('[Cinema Seed] Connecting to database...');
  const client = await writerPool.connect();

  try {
    const { movieIds, source } = await resolveMovieIds();
    const seededMovieIds = movieIds.slice(0, SEED_MOVIE_COUNT);
    console.log(`[Cinema Seed] Movie IDs source: ${source}`);
    console.log(
      `[Cinema Seed] Scheduling showtimes for the first ${seededMovieIds.length} movie(s): [${seededMovieIds.join(', ')}]`
    );

    await client.query('BEGIN');

    // 1. Seed Cinemas
    for (const cinema of SEED_CINEMAS) {
      await client.query(
        `INSERT INTO cinemas (id, name, city, address)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [cinema.id, cinema.name, cinema.city, cinema.address]
      );
    }

    // 2. Seed Screens and Halls (populates both for API compatibility)
    for (const hall of SEED_HALLS) {
      await client.query(
        `INSERT INTO screens (id, cinema_id, name, total_seats)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [hall.id, hall.cinemaId, hall.name, hall.totalSeats]
      );

      // Screens carry their own price (migration 007). Updating by id keeps
      // re-runs idempotent and covers screens with no showtime history.
      await client.query(
        `UPDATE screens SET price_kobo = $2 WHERE id = $1`,
        [hall.id, hall.priceKobo]
      );

      await client.query(
        `INSERT INTO halls (id, cinema_id, name, total_seats)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [hall.id, hall.cinemaId, hall.name, hall.totalSeats]
      );
    }

    // 3. Seed Seats
    for (const hall of SEED_HALLS) {
      for (const row of hall.rows) {
        for (let seatNum = 1; seatNum <= hall.seatsPerRow; seatNum++) {
          const isAccessible = hall.accessibleSeats.some(
            (s) => s.row === row && s.number === seatNum
          );
          const seatType = isAccessible ? 'wheelchair' : 'standard';

          await client.query(
            `INSERT INTO seats (screen_id, hall_id, row_label, "row", seat_number, "number", seat_type, accessible)
             VALUES ($1, $1, $2, $2, $3, $3, $4, $5)
             ON CONFLICT (screen_id, row_label, seat_number) DO NOTHING`,
            [hall.id, row, seatNum, seatType, isAccessible]
          );
        }
      }
    }

    // 4. Seed Showtimes (next 8 days at 13:00, 16:30, 20:00 Africa/Lagos time).
    //    First 3 screens by id, deterministic 9-cell daily movie rotation.
    const schedule = getLagosScheduleSlots(8);
    const showtimeScreens = selectFirstScreensById(SEED_HALLS);
    const showtimeRows = buildSeedShowtimes(seededMovieIds, showtimeScreens, schedule);

    console.log(
      `[Cinema Seed] Showtime screens: ${showtimeScreens.map((s) => s.name).join(', ')}`
    );

    for (const row of showtimeRows) {
      await client.query(
        `INSERT INTO showtimes (movie_id, screen_id, hall_id, starts_at, price_kobo)
         SELECT $1, $2, $2, $3::timestamptz, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM showtimes
           WHERE screen_id = $2 AND starts_at = $3::timestamptz
         )`,
        [row.movieId, row.screenId, row.startsAt, row.priceKobo]
      );
    }

    await client.query('COMMIT');
    console.log('[Cinema Seed] Transaction committed.');

    // 5. Query and print row counts per table
    const cinemasCount = (await client.query('SELECT count(*)::int AS c FROM cinemas')).rows[0].c;
    const screensCount = (await client.query('SELECT count(*)::int AS c FROM screens')).rows[0].c;
    const hallsCount = (await client.query('SELECT count(*)::int AS c FROM halls')).rows[0].c;
    const seatsCount = (await client.query('SELECT count(*)::int AS c FROM seats')).rows[0].c;
    const showtimesCount = (await client.query('SELECT count(*)::int AS c FROM showtimes')).rows[0].c;

    console.log('[Cinema Seed] Table row counts:');
    console.log(`  - cinemas:   ${cinemasCount}`);
    console.log(`  - screens:   ${screensCount}`);
    console.log(`  - halls:     ${hallsCount}`);
    console.log(`  - seats:     ${seatsCount}`);
    console.log(`  - showtimes: ${showtimesCount}`);
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await writerPool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed-cinema.ts')) {
  seedCinema()
    .then(() => {
      console.log('[Cinema Seed] Completed with exit code 0.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Cinema Seed Error]', err.message);
      process.exit(1);
    });
}
