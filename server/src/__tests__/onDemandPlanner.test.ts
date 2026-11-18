import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getLagosHorizonDays,
  isMovieEligibleForHorizon,
  lagosSlotToUtcMs,
  planOnDemandShowtimes,
  showtimeBlocksOverlap,
  type ScreenDefinition,
} from '../lib/onDemandShowtimes.js';

// Planner inputs are always supplied by the caller now (loaded from the DB in production).
const TEST_SCREENS: ScreenDefinition[] = [
  {
    id: 'b0000001-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    name: 'Screen 1 (Grand)',
    priceKobo: 350000,
  },
  {
    id: 'b0000001-0000-4000-8000-000000000002',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    name: 'Screen 2 (VIP)',
    priceKobo: 450000,
  },
  {
    id: 'b0000002-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    name: 'Screen 1 (Main)',
    priceKobo: 300000,
  },
  {
    id: 'b0000002-0000-4000-8000-000000000002',
    cinemaId: 'a0000001-0000-4000-8000-000000000002',
    name: 'Screen 2 (Arena)',
    priceKobo: 400000,
  },
];

describe('Task 2: Pure On-Demand Showtime Planner', () => {
  // Fixed test reference time: Wednesday, 2026-11-18 at 09:00:00 UTC (10:00:00 Lagos time)
  const fixedNow = new Date('2026-11-18T09:00:00.000Z');

  it('is completely deterministic (identical inputs produce identical results)', () => {
    const params = {
      movieId: '933260',
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
    };

    const run1 = planOnDemandShowtimes(params);
    const run2 = planOnDemandShowtimes(params);

    expect(run1).toEqual(run2);
    expect(run1.length).toBeGreaterThan(0);
  });

  it('guarantees no overlaps: no two showtimes on the same screen within 3 hours (180 min)', () => {
    const planned = planOnDemandShowtimes({
      movieId: '550',
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 7,
      slotsPerMoviePerDay: 2,
    });

    // Check all pairs on the same screen
    for (let i = 0; i < planned.length; i++) {
      for (let j = i + 1; j < planned.length; j++) {
        if (planned[i].screenId === planned[j].screenId) {
          const t1 = new Date(planned[i].startsAt).getTime();
          const t2 = new Date(planned[j].startsAt).getTime();
          const diffMs = Math.abs(t1 - t2);
          expect(diffMs).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000);
        }
      }
    }
  });

  it('enforces lead time: skips slots starting less than minLeadMinutes from now', () => {
    // Lagos time 12:30 on 2026-11-18 (11:30 UTC).
    // Today's first slot is 13:00 (30 min away). With minLeadMinutes = 60, 13:00 must be skipped.
    const lateNow = new Date('2026-11-18T11:30:00.000Z');

    const planned = planOnDemandShowtimes({
      movieId: '550',
      now: lateNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 1,
      minLeadMinutes: 60,
    });

    for (const st of planned) {
      const startsAtMs = new Date(st.startsAt).getTime();
      const diffMs = startsAtMs - lateNow.getTime();
      expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(st.startsAt).not.toContain('13:00:00');
    }
  });

  it('enforces release date rules: never schedules before release date', () => {
    // Release date is 3 days in the future (2026-11-21)
    const futureRelease = '2026-11-21';

    const planned = planOnDemandShowtimes({
      movieId: '777',
      releaseDate: futureRelease,
      now: fixedNow, // 2026-11-18
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 7,
    });

    for (const st of planned) {
      const stDate = st.startsAt.split('T')[0];
      expect(stDate >= futureRelease).toBe(true);
    }
  });

  it('returns empty array if release date is after the end of the horizon (not eligible)', () => {
    // Horizon is 7 days from 2026-11-18 (ends 2026-11-24)
    // Movie releases 2026-12-01
    const farFutureRelease = '2026-12-01';

    const planned = planOnDemandShowtimes({
      movieId: '888',
      releaseDate: farFutureRelease,
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 7,
    });

    expect(planned).toEqual([]);
  });

  it('correctly handles the Lagos midnight boundary (UTC+1, no DST)', () => {
    // Test a UTC timestamp right at 23:30 UTC on Nov 18
    // In Lagos (+01:00), it is 00:30 on Nov 19!
    const nearMidnightUtc = new Date('2026-11-18T23:30:00.000Z');
    const horizon = getLagosHorizonDays(nearMidnightUtc, 3);

    // Day 0 in Lagos must be 2026-11-19, NOT 2026-11-18
    expect(horizon[0].dateStr).toBe('2026-11-19');
    expect(horizon[1].dateStr).toBe('2026-11-20');
    expect(horizon[2].dateStr).toBe('2026-11-21');

    // lagosSlotToUtcMs check for 20:00 Lagos time on 2026-11-19
    const utcMs = lagosSlotToUtcMs(2026, 11, 19, '20:00');
    const expectedUtc = Date.UTC(2026, 10, 19, 19, 0, 0); // 19:00 UTC = 20:00 Lagos
    expect(utcMs).toBe(expectedUtc);
  });

  it('uses weekday slot grid (13:00, 16:30, 20:00) vs weekend slot grid (10:30, 13:45, 17:00, 20:15)', () => {
    // 2026-11-18 is Wednesday (weekday)
    // 2026-11-21 is Saturday (weekend)
    const planned = planOnDemandShowtimes({
      movieId: '123',
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 7,
      slotsPerMoviePerDay: 4,
    });

    const wednesdayShows = planned.filter((s) => s.startsAt.startsWith('2026-11-18'));
    for (const st of wednesdayShows) {
      const time = st.startsAt.slice(11, 16);
      expect(['13:00', '16:30', '20:00']).toContain(time);
    }

    const saturdayShows = planned.filter((s) => s.startsAt.startsWith('2026-11-21'));
    for (const st of saturdayShows) {
      const time = st.startsAt.slice(11, 16);
      expect(['10:30', '13:45', '17:00', '20:15']).toContain(time);
    }
  });

  it('skips occupied slots where an existing showtime on that screen starts within 3 hours', () => {
    const screen1 = TEST_SCREENS[0].id;
    // Occupy Screen 1 at 13:00 on 2026-11-18
    const existing = [
      {
        screenId: screen1,
        startsAt: '2026-11-18T13:00:00+01:00',
      },
    ];

    const planned = planOnDemandShowtimes({
      movieId: '100',
      now: fixedNow,
      existingShowtimes: existing,
      screens: TEST_SCREENS,
      horizonDays: 1,
      slotsPerMoviePerDay: 2,
    });

    // Screen 1 must NOT have any showtime at 13:00 or within 3 hours
    for (const st of planned) {
      if (st.screenId === screen1) {
        expect(st.startsAt).not.toBe('2026-11-18T13:00:00+01:00');
        const diff = Math.abs(
          new Date(st.startsAt).getTime() - new Date('2026-11-18T13:00:00+01:00').getTime(),
        );
        expect(diff).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000);
      }
    }
  });

  it('trims to caps: respects maxShowtimesPerMovie', () => {
    const planned = planOnDemandShowtimes({
      movieId: '550',
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 7,
      slotsPerMoviePerDay: 2,
      maxShowtimesPerMovie: 5, // strict cap of 5
    });

    expect(planned.length).toBe(5);
  });

  it('trims to caps: accounts for existingMovieShowtimesCount', () => {
    const planned = planOnDemandShowtimes({
      movieId: '550',
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 7,
      slotsPerMoviePerDay: 2,
      maxShowtimesPerMovie: 30,
      existingMovieShowtimesCount: 28, // already has 28
    });

    expect(planned.length).toBe(2);
  });

  it('requires caller-supplied screens and holds no hardcoded screen IDs or prices', () => {
    const filePath = path.resolve(__dirname, '../lib/onDemandShowtimes.ts');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).not.toContain('DEFAULT_SCREENS');
    expect(source).not.toContain('b0000001-0000-4000-8000-000000000001');
    expect(source).not.toContain('b0000002-0000-4000-8000-000000000001');
    expect(source).not.toContain('priceKobo: 350000');
    expect(source).not.toContain('priceKobo: 450000');

    const planned = planOnDemandShowtimes({
      movieId: '550',
      now: fixedNow,
      existingShowtimes: [],
      screens: [],
      horizonDays: 7,
    });

    expect(planned).toEqual([]);
  });

  it('does not emit hallId: the table is screens', () => {
    const planned = planOnDemandShowtimes({
      movieId: '550',
      now: fixedNow,
      existingShowtimes: [],
      screens: TEST_SCREENS,
      horizonDays: 1,
      slotsPerMoviePerDay: 2,
    });

    expect(planned.length).toBeGreaterThan(0);
    for (const st of planned) {
      expect(Object.prototype.hasOwnProperty.call(st, 'hallId')).toBe(false);
    }

    const filePath = path.resolve(__dirname, '../lib/onDemandShowtimes.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).not.toContain('hallId');
  });

  it('treats cancelled showtimes as occupied because they still hold the unique slot', () => {
    const screen1 = TEST_SCREENS[0].id;
    const planned = planOnDemandShowtimes({
      movieId: '100', // starts on screen 1 for dayIndex 0
      now: fixedNow,
      existingShowtimes: [
        {
          screenId: screen1,
          startsAt: '2026-11-18T13:00:00+01:00',
          cancelled: true,
        },
      ],
      screens: TEST_SCREENS,
      horizonDays: 1,
      slotsPerMoviePerDay: 3,
    });

    const screen1At13 = planned.find(
      (st) => st.screenId === screen1 && st.startsAt === '2026-11-18T13:00:00+01:00',
    );
    expect(screen1At13).toBeUndefined();
  });

  it('treats a 3-hour showtime as an interval: 13:00 blocks 10:30 and 13:45, but not 17:00', () => {
    const existingMs = new Date('2026-11-18T13:00:00+01:00').getTime();

    expect(showtimeBlocksOverlap(existingMs, new Date('2026-11-18T10:30:00+01:00').getTime())).toBe(true);
    expect(showtimeBlocksOverlap(existingMs, new Date('2026-11-18T13:45:00+01:00').getTime())).toBe(true);
    expect(showtimeBlocksOverlap(existingMs, new Date('2026-11-18T17:00:00+01:00').getTime())).toBe(false);

    // Symmetric: an earlier block also blocks a later candidate.
    expect(showtimeBlocksOverlap(new Date('2026-11-18T10:30:00+01:00').getTime(), existingMs)).toBe(true);

    // Touching blocks do not overlap (one ends exactly as the next begins).
    expect(showtimeBlocksOverlap(existingMs, new Date('2026-11-18T16:00:00+01:00').getTime())).toBe(false);
  });

  it('planner blocks overlapping weekend slots from an existing 13:00 showtime', () => {
    const screen = TEST_SCREENS[0];
    const saturday = '2026-11-21';

    const planned = planOnDemandShowtimes({
      movieId: '100',
      now: fixedNow,
      existingShowtimes: [{ screenId: screen.id, startsAt: `${saturday}T13:00:00+01:00` }],
      screens: [screen],
      horizonDays: 4,
      slotsPerMoviePerDay: 4,
    });

    const saturdayTimes = planned
      .filter((st) => st.startsAt.startsWith(saturday))
      .map((st) => st.startsAt.slice(11, 16));

    expect(saturdayTimes).not.toContain('10:30');
    expect(saturdayTimes).not.toContain('13:45');
    expect(saturdayTimes).toContain('17:00');
  });

  it('a cancelled showtime blocks the same overlapping interval', () => {
    const screen = TEST_SCREENS[0];
    const saturday = '2026-11-21';

    const planned = planOnDemandShowtimes({
      movieId: '100',
      now: fixedNow,
      existingShowtimes: [
        { screenId: screen.id, startsAt: `${saturday}T13:00:00+01:00`, cancelled: true },
      ],
      screens: [screen],
      horizonDays: 4,
      slotsPerMoviePerDay: 4,
    });

    const saturdayTimes = planned
      .filter((st) => st.startsAt.startsWith(saturday))
      .map((st) => st.startsAt.slice(11, 16));

    expect(saturdayTimes).not.toContain('10:30');
    expect(saturdayTimes).not.toContain('13:45');
    expect(saturdayTimes).toContain('17:00');
  });

  it('eligibility helper rejects a release date after the horizon end', () => {
    expect(isMovieEligibleForHorizon('2026-11-24', fixedNow, 7)).toBe(true);
    expect(isMovieEligibleForHorizon('2026-11-25', fixedNow, 7)).toBe(false);
    expect(isMovieEligibleForHorizon('', fixedNow, 7)).toBe(true);
  });

  it('source scan proves NO Math.random and NO createHash in onDemandShowtimes.ts', () => {
    const filePath = path.resolve(__dirname, '../lib/onDemandShowtimes.ts');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('createHash');
  });
});
