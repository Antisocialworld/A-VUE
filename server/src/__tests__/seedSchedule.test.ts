import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEED_MOVIE_COUNT,
  SEED_SCREEN_COUNT,
  buildSeedShowtimes,
  selectFirstScreensById,
  type SeedScheduleDay,
} from '../lib/seedSchedule.js';

// The script loads movie ids from the backend (or its fallback list), then keeps
// only the first SEED_MOVIE_COUNT in load order.
const LOADED_MOVIE_IDS = ['550', '933260', '1022789', '533535', '693134', '823464'];
const MOVIE_IDS = LOADED_MOVIE_IDS.slice(0, SEED_MOVIE_COUNT);

// Real ids and prices from SEED_HALLS, deliberately shuffled so the selector
// cannot accidentally pass by relying on input order.
const HALLS = [
  {
    id: 'b0000002-0000-4000-8000-000000000002',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    priceKobo: 400000,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000002',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    priceKobo: 450000,
  },
  {
    id: 'b0000002-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    priceKobo: 300000,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    priceKobo: 350000,
  },
];

const SCHEDULE: SeedScheduleDay[] = Array.from({ length: 8 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10, 18 + i));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return {
    dateStr: `${d.getUTCFullYear()}-${mm}-${dd}`,
    times: ['13:00', '16:30', '20:00'],
  };
});

const SCREENS = selectFirstScreensById(HALLS);
const ROWS = buildSeedShowtimes(MOVIE_IDS, SCREENS, SCHEDULE);

describe('Task S2: deterministic cinema seed schedule', () => {
  it('exports the seed counts and selects the first 3 screens sorted by id', () => {
    expect(SEED_MOVIE_COUNT).toBe(3);
    expect(SEED_SCREEN_COUNT).toBe(3);

    expect(SCREENS.map((s) => s.id)).toEqual([
      'b0000001-0000-4000-8000-000000000001',
      'b0000001-0000-4000-8000-000000000002',
      'b0000002-0000-4000-8000-000000000001',
    ]);
    expect(SCREENS.map((s) => s.priceKobo)).toEqual([350000, 450000, 300000]);

    // The fourth screen (Ikeja Arena) keeps its seed price but gets no showtimes.
    const remaining = HALLS.filter((hall) => !SCREENS.some((screen) => screen.id === hall.id));
    expect(remaining.map((hall) => hall.id)).toEqual([
      'b0000002-0000-4000-8000-000000000002',
    ]);
  });

  it('selects deterministically regardless of input order', () => {
    const reversed = selectFirstScreensById([...HALLS].reverse());
    expect(reversed).toEqual(SCREENS);
  });

  it('produces 9 cells per day for 8 days (72 rows)', () => {
    expect(ROWS).toHaveLength(8 * 9);
  });

  it('never repeats (screen_id, starts_at)', () => {
    const keys = ROWS.map((row) => `${row.screenId}|${row.startsAt}`);
    expect(new Set(keys).size).toBe(ROWS.length);
  });

  it('never puts the same movie on two screens at the same start time', () => {
    const byStart = new Map<string, string[]>();
    for (const row of ROWS) {
      const list = byStart.get(row.startsAt) ?? [];
      list.push(row.movieId);
      byStart.set(row.startsAt, list);
    }

    expect(byStart.size).toBe(8 * 3);
    for (const movieList of byStart.values()) {
      expect(new Set(movieList).size).toBe(movieList.length);
    }
  });

  it('gives every movie 3 showings per day on 3 distinct screens, one per slot', () => {
    for (const day of SCHEDULE) {
      const dayRows = ROWS.filter((row) => row.startsAt.startsWith(day.dateStr));
      expect(dayRows).toHaveLength(9);

      for (const movieId of MOVIE_IDS) {
        const movieRows = dayRows.filter((row) => row.movieId === movieId);

        expect(movieRows).toHaveLength(3);
        expect(new Set(movieRows.map((row) => row.screenId)).size).toBe(3);
        expect(new Set(movieRows.map((row) => row.startsAt)).size).toBe(3);
        expect(new Set(movieRows.map((row) => row.startsAt))).toEqual(
          new Set(day.times.map((time) => `${day.dateStr}T${time}:00+01:00`)),
        );
      }
    }
  });

  it('uses all 3 screens and both cinemas every day, leaving the fourth screen empty', () => {
    const screenIds = new Set(SCREENS.map((screen) => screen.id));
    const cinemaIds = new Set(SCREENS.map((screen) => screen.cinemaId));

    for (const day of SCHEDULE) {
      const dayRows = ROWS.filter((row) => row.startsAt.startsWith(day.dateStr));
      expect(new Set(dayRows.map((row) => row.screenId))).toEqual(screenIds);
      expect(
        new Set(
          dayRows.map(
            (row) => SCREENS.find((screen) => screen.id === row.screenId)!.cinemaId,
          ),
        ),
      ).toEqual(cinemaIds);
    }

    expect(cinemaIds).toEqual(
      new Set([
        'a0000001-0000-4000-8000-000000000001',
        'a0000001-0000-4000-8000-000000000002',
      ]),
    );
    expect(ROWS.some((row) => row.screenId === 'b0000002-0000-4000-8000-000000000002')).toBe(
      false,
    );
  });

  it('is identical across runs for identical inputs', () => {
    expect(buildSeedShowtimes(MOVIE_IDS, SCREENS, SCHEDULE)).toEqual(ROWS);
  });

  it('uses movieIds[(slotIdx + screenIdx + dayIdx) % 3]', () => {
    expect(MOVIE_IDS).toHaveLength(3);

    for (let dayIdx = 0; dayIdx < SCHEDULE.length; dayIdx++) {
      const day = SCHEDULE[dayIdx];

      for (let slotIdx = 0; slotIdx < day.times.length; slotIdx++) {
        for (let screenIdx = 0; screenIdx < SCREENS.length; screenIdx++) {
          const row = ROWS[dayIdx * 9 + slotIdx * 3 + screenIdx];

          expect(row.movieId).toBe(MOVIE_IDS[(slotIdx + screenIdx + dayIdx) % 3]);
          expect(row.screenId).toBe(SCREENS[screenIdx].id);
          expect(row.startsAt).toBe(`${day.dateStr}T${day.times[slotIdx]}:00+01:00`);
          expect(row.priceKobo).toBe(SCREENS[screenIdx].priceKobo);
        }
      }
    }
  });

  it('keeps only the first 3 loaded movie ids in the seed', () => {
    expect(LOADED_MOVIE_IDS.slice(0, SEED_MOVIE_COUNT)).toEqual(MOVIE_IDS);
    expect(MOVIE_IDS).toEqual(['550', '933260', '1022789']);
  });
});

describe('Task S2: seed-cinema.ts wiring', () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/seed-cinema.ts');
  const scriptSrc = fs.readFileSync(scriptPath, 'utf-8');

  it('builds rows from the first 3 movies and first 3 screens via the pure module', () => {
    expect(scriptSrc).toContain('getLagosScheduleSlots(8)');
    expect(scriptSrc).toContain('movieIds.slice(0, SEED_MOVIE_COUNT)');
    expect(scriptSrc).toContain('selectFirstScreensById(SEED_HALLS)');
    expect(scriptSrc).toContain(
      'buildSeedShowtimes(seededMovieIds, showtimeScreens, schedule)',
    );
  });

  it('no longer uses the old one-screen-per-cinema selector', () => {
    expect(scriptSrc).not.toContain('selectLowestIdScreenPerCinema');
  });

  it('guards inserts on (screen_id, starts_at) only, with no ON CONFLICT or source', () => {
    const start = scriptSrc.indexOf('INSERT INTO showtimes');
    const end = scriptSrc.indexOf('[row.movieId');

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const insertBlock = scriptSrc.slice(start, end);
    expect(insertBlock).toContain('WHERE NOT EXISTS');
    expect(insertBlock).toContain('WHERE screen_id = $2 AND starts_at = $3::timestamptz');
    expect(insertBlock).not.toContain('movie_id = $1');
    expect(insertBlock).not.toContain('ON CONFLICT');
    expect(insertBlock).not.toContain('source');
  });

  it('inserts each row at its own screen price', () => {
    const start = scriptSrc.indexOf('INSERT INTO showtimes');
    const end = scriptSrc.indexOf('[row.movieId');

    const insertBlock = scriptSrc.slice(start, end);
    expect(insertBlock).toContain('price_kobo)');
    expect(insertBlock).toContain('$4');
    expect(scriptSrc).toContain('[row.movieId, row.screenId, row.startsAt, row.priceKobo]');
  });
});
