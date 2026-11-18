import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEED_MOVIE_COUNT,
  SEED_SCREEN_COUNT,
  buildSeedShowtimes,
  selectSeededScreens,
  type SeedScheduleDay,
  type SeededScheduleHall,
} from '../lib/seedSchedule.js';

// The script loads movie ids from the backend (or its fallback list), then keeps
// only the first SEED_MOVIE_COUNT in load order.
const LOADED_MOVIE_IDS = ['550', '933260', '1022789', '533535', '693134', '823464'];
const MOVIE_IDS = LOADED_MOVIE_IDS.slice(0, SEED_MOVIE_COUNT);

// Real ids and prices, deliberately shuffled so selection cannot rely on input order.
// Includes 3 seeded screens and 4 free screens (on-demand).
const HALLS: SeededScheduleHall[] = [
  {
    id: 'b0000002-0000-4000-8000-000000000002',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    priceKobo: 400000,
    isSeeded: false,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000004',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    priceKobo: 420000,
    isSeeded: false,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000002',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    priceKobo: 450000,
    isSeeded: true,
  },
  {
    id: 'b0000002-0000-4000-8000-000000000003',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    priceKobo: 380000,
    isSeeded: false,
  },
  {
    id: 'b0000002-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    priceKobo: 300000,
    isSeeded: true,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000003',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    priceKobo: 320000,
    isSeeded: false,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    priceKobo: 350000,
    isSeeded: true,
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

const SCREENS = selectSeededScreens(HALLS);
const ROWS = buildSeedShowtimes(MOVIE_IDS, SCREENS, SCHEDULE);

describe('Task E2: deterministic cinema seed schedule (is_seeded selection)', () => {
  it('exports the seed counts and selects exactly the 3 is_seeded screens sorted by id', () => {
    expect(SEED_MOVIE_COUNT).toBe(3);
    expect(SEED_SCREEN_COUNT).toBe(3);

    expect(SCREENS.map((s) => s.id)).toEqual([
      'b0000001-0000-4000-8000-000000000001', // VI Grand
      'b0000001-0000-4000-8000-000000000002', // VI VIP
      'b0000002-0000-4000-8000-000000000001', // Ikeja Main
    ]);
    expect(SCREENS.every((s) => s.isSeeded)).toBe(true);
    expect(SCREENS.map((s) => s.priceKobo)).toEqual([350000, 450000, 300000]);
  });

  it('selects seeded screens deterministically regardless of input order', () => {
    const reversed = selectSeededScreens([...HALLS].reverse());
    expect(reversed).toEqual(SCREENS);
  });

  it('fails loudly with a clear error when is_seeded count is not 3', () => {
    const tooFew = HALLS.filter((h) => h.id !== 'b0000002-0000-4000-8000-000000000001');
    expect(() => selectSeededScreens(tooFew)).toThrowError(
      'Expected exactly 3 seeded screens (is_seeded = true), found 2.',
    );

    const tooMany = [
      ...HALLS,
      {
        id: 'b0000002-0000-4000-8000-000000000099',
        cinemaId: 'a0000001-0000-4000-8000-000000000002',
        priceKobo: 310000,
        isSeeded: true,
      },
    ];
    expect(() => selectSeededScreens(tooMany)).toThrowError(
      'Expected exactly 3 seeded screens (is_seeded = true), found 4.',
    );
  });

  it('produces 9 cells per day for 8 days (72 rows) and keeps free screens unseeded', () => {
    expect(ROWS).toHaveLength(8 * 9);

    const seededIds = new Set(SCREENS.map((s) => s.id));
    const freeIds = HALLS.filter((h) => !h.isSeeded).map((h) => h.id);
    expect(freeIds.length).toBeGreaterThan(0);
    for (const row of ROWS) {
      expect(seededIds.has(row.screenId)).toBe(true);
    }
    for (const freeId of freeIds) {
      expect(ROWS.some((row) => row.screenId === freeId)).toBe(false);
    }
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

  it('uses all 3 seeded screens and both cinemas every day', () => {
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

describe('Task E2: seed-cinema.ts wiring', () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/seed-cinema.ts');
  const scriptSrc = fs.readFileSync(scriptPath, 'utf-8');

  it('builds rows from the first 3 movies and is_seeded screens via the pure module', () => {
    expect(scriptSrc).toContain('getLagosScheduleSlots(8)');
    expect(scriptSrc).toContain('movieIds.slice(0, SEED_MOVIE_COUNT)');
    expect(scriptSrc).toContain('selectSeededScreens(SEED_HALLS)');
    expect(scriptSrc).toContain(
      'buildSeedShowtimes(seededMovieIds, showtimeScreens, schedule)',
    );
  });

  it('no longer uses the old id-order screen selector', () => {
    expect(scriptSrc).not.toContain('selectFirstScreensById');
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
