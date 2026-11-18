import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSeedShowtimes,
  selectLowestIdScreenPerCinema,
  type SeedScheduleDay,
} from '../lib/seedSchedule.js';

const MOVIE_IDS = ['550', '933260', '1022789', '533535', '693134', '823464'];

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

const SCREENS = selectLowestIdScreenPerCinema(HALLS);
const ROWS = buildSeedShowtimes(MOVIE_IDS, SCREENS, SCHEDULE);

describe('Task S: deterministic cinema seed schedule', () => {
  it('schedules exactly one screen per cinema: the lowest-id screen', () => {
    expect(SCREENS.map((s) => s.id)).toEqual([
      'b0000001-0000-4000-8000-000000000001',
      'b0000002-0000-4000-8000-000000000001',
    ]);
    expect(SCREENS.map((s) => s.priceKobo)).toEqual([350000, 300000]);
    expect(new Set(SCREENS.map((s) => s.cinemaId)).size).toBe(SCREENS.length);
  });

  it('produces 6 cells per day for 8 days (48 rows)', () => {
    expect(ROWS).toHaveLength(8 * 6);
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

  it('gives every movie at least one slot every day (lists of 6 or fewer)', () => {
    for (const movieIds of [MOVIE_IDS, MOVIE_IDS.slice(0, 5)]) {
      const rows = buildSeedShowtimes(movieIds, SCREENS, SCHEDULE);

      for (const day of SCHEDULE) {
        const dayMovies = new Set(
          rows.filter((row) => row.startsAt.startsWith(day.dateStr)).map((row) => row.movieId),
        );
        for (const movieId of movieIds) {
          expect(dayMovies.has(movieId)).toBe(true);
        }
      }
    }
  });

  it('is identical across runs for identical inputs', () => {
    expect(buildSeedShowtimes(MOVIE_IDS, SCREENS, SCHEDULE)).toEqual(ROWS);
  });

  it('uses movieIds[(d * 6 + slotIdx * 2 + screenIdx) % length]', () => {
    for (let d = 0; d < SCHEDULE.length; d++) {
      const day = SCHEDULE[d];

      for (let slotIdx = 0; slotIdx < day.times.length; slotIdx++) {
        for (let screenIdx = 0; screenIdx < SCREENS.length; screenIdx++) {
          const cellIndex = slotIdx * 2 + screenIdx;
          const row = ROWS[d * 6 + cellIndex];

          expect(row.movieId).toBe(MOVIE_IDS[(d * 6 + cellIndex) % MOVIE_IDS.length]);
          expect(row.screenId).toBe(SCREENS[screenIdx].id);
          expect(row.startsAt).toBe(`${day.dateStr}T${day.times[slotIdx]}:00+01:00`);
          expect(row.priceKobo).toBe(SCREENS[screenIdx].priceKobo);
        }
      }
    }
  });
});

describe('Task S: seed-cinema.ts wiring', () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/seed-cinema.ts');
  const scriptSrc = fs.readFileSync(scriptPath, 'utf-8');

  it('builds rows from SEED_HALLS via the pure schedule module', () => {
    expect(scriptSrc).toContain('getLagosScheduleSlots(8)');
    expect(scriptSrc).toContain('selectLowestIdScreenPerCinema(SEED_HALLS)');
    expect(scriptSrc).toContain('buildSeedShowtimes(movieIds, showtimeScreens, schedule)');
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
});
