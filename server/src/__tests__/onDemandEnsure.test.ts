import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureOnDemandShowtimes,
  type EnsureCaps,
  type OnDemandStore,
} from '../lib/onDemandEnsure.js';
import type { ExistingShowtimeItem, ScreenDefinition } from '../lib/onDemandShowtimes.js';

// Wednesday 2026-11-18, 10:00 Lagos (UTC+1). Horizon day 0 is 2026-11-18.
const FIXED_NOW = new Date('2026-11-18T09:00:00.000Z');

const SCREENS: ScreenDefinition[] = [
  {
    id: 'b0000001-0000-4000-8000-000000000001',
    cinemaId: 'a0000001-0000-4000-8000-000000000001',
    name: 'Screen 1 (Grand)',
    priceKobo: 350000,
  },
];

const CAPS: EnsureCaps = {
  horizonDays: 1,
  minLeadMinutes: 60,
  slotsPerMoviePerDay: 2,
  maxShowtimesPerMovie: 30,
  maxNewMoviesPerDay: 25,
  maxActiveShowtimes: 1000,
};

interface FakeStoreConfig {
  activeForMovie?: number;
  activeTotal?: number;
  newMoviesToday?: number;
  screens?: ScreenDefinition[];
  occupied?: ExistingShowtimeItem[];
  insertError?: Error;
  insertCreated?: number;
}

interface FakeStore extends OnDemandStore {
  calls: string[];
  inserted: Parameters<OnDemandStore['insertShowtimes']>[0];
}

function makeStore(overrides: FakeStoreConfig = {}): FakeStore {
  const calls: string[] = [];
  const state = {
    activeForMovie: overrides.activeForMovie ?? 0,
    activeTotal: overrides.activeTotal ?? 0,
    newMoviesToday: overrides.newMoviesToday ?? 0,
    screens: overrides.screens ?? SCREENS,
    occupied: overrides.occupied ?? [],
  };

  const store: FakeStore = {
    calls,
    inserted: [],
    async begin() {
      calls.push('begin');
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
    },
    async lockMovie(movieId: number) {
      calls.push(`lock:${movieId}`);
    },
    async countActiveForMovie() {
      calls.push('countActiveForMovie');
      return state.activeForMovie;
    },
    async countActive() {
      calls.push('countActive');
      return state.activeTotal;
    },
    async countNewMoviesForDay() {
      calls.push('countNewMoviesForDay');
      return state.newMoviesToday;
    },
    async listScreens() {
      calls.push('listScreens');
      return state.screens;
    },
    async listOccupied() {
      calls.push('listOccupied');
      return state.occupied;
    },
    async insertShowtimes(planned) {
      calls.push('insertShowtimes');
      if (overrides.insertError) {
        throw overrides.insertError;
      }
      store.inserted = planned;
      return overrides.insertCreated ?? planned.length;
    },
  };

  return store;
}

describe('On-demand ensure core (transactional, no live DB)', () => {
  it('creates showtimes for an eligible movie using DB-supplied screens and prices', async () => {
    const store = makeStore();

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 2 });
    expect(store.inserted).toHaveLength(2);
    expect(store.inserted[0]).toMatchObject({
      movieId: '100',
      screenId: SCREENS[0].id,
      priceKobo: 350000,
      source: 'on_demand',
    });
    expect(store.calls[store.calls.length - 1]).toBe('commit');
  });

  it('serialises on the per-movie advisory lock before reading any state', async () => {
    const store = makeStore();

    await ensureOnDemandShowtimes({
      movieId: 42,
      releaseDate: '2020-01-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(store.calls.slice(0, 3)).toEqual(['begin', 'lock:42', 'countActiveForMovie']);
  });

  it('is idempotent: an existing active showtime for the movie means created: 0', async () => {
    const store = makeStore({ activeForMovie: 3 });

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 0 });
    expect(store.calls).not.toContain('insertShowtimes');
    expect(store.calls).toContain('commit');
  });

  it('returns NOT_ELIGIBLE before opening a transaction when the release is after the horizon', async () => {
    const store = makeStore();

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-25',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 0, reason: 'NOT_ELIGIBLE' });
    expect(store.calls).toEqual([]);
  });

  it('returns CAP_REACHED when the active-showtime cap is already hit', async () => {
    const store = makeStore({ activeTotal: CAPS.maxActiveShowtimes });

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 0, reason: 'CAP_REACHED' });
    expect(store.calls).not.toContain('listScreens');
  });

  it('returns CAP_REACHED when the new-movies-per-day cap is hit', async () => {
    const store = makeStore({ newMoviesToday: CAPS.maxNewMoviesPerDay });

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 0, reason: 'CAP_REACHED' });
    expect(store.calls).not.toContain('listScreens');
  });

  it('returns NO_CAPACITY when no screen has a price', async () => {
    const store = makeStore({ screens: [] });

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 0, reason: 'NO_CAPACITY' });
    expect(store.calls).not.toContain('insertShowtimes');
  });

  it('treats cancelled showtimes as occupied slots', async () => {
    const store = makeStore({
      occupied: [
        {
          screenId: SCREENS[0].id,
          startsAt: '2026-11-18T13:00:00+01:00',
          cancelled: true,
        },
      ],
    });

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 2 });
    const startsAtList = store.inserted.map((item) => item.startsAt);
    expect(startsAtList).not.toContain('2026-11-18T13:00:00+01:00');
    expect(startsAtList).toContain('2026-11-18T16:30:00+01:00');
  });

  it('reports NO_CAPACITY when every planned slot lost the unique conflict race', async () => {
    const store = makeStore({ insertCreated: 0 });

    const result = await ensureOnDemandShowtimes({
      movieId: 100,
      releaseDate: '2026-11-01',
      now: FIXED_NOW,
      caps: CAPS,
      store,
    });

    expect(result).toEqual({ created: 0, reason: 'NO_CAPACITY' });
  });

  it('rolls back and rethrows when the insert fails', async () => {
    const store = makeStore({ insertError: new Error('db down') });

    await expect(
      ensureOnDemandShowtimes({
        movieId: 100,
        releaseDate: '2026-11-01',
        now: FIXED_NOW,
        caps: CAPS,
        store,
      }),
    ).rejects.toThrow('db down');

    expect(store.calls).toContain('rollback');
    expect(store.calls).not.toContain('commit');
  });
});

describe('On-demand ensure SQL and route invariants', () => {
  const ensureSrc = fs.readFileSync(
    path.resolve(__dirname, '../lib/onDemandEnsure.ts'),
    'utf-8',
  );
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../routes/showtimes.ts'),
    'utf-8',
  );

  it('locks per movie with pg_advisory_xact_lock', () => {
    expect(ensureSrc).toContain('pg_advisory_xact_lock');
  });

  it('inserts with ON CONFLICT (screen_id, starts_at) DO NOTHING', () => {
    expect(ensureSrc).toContain('ON CONFLICT (screen_id, starts_at) DO NOTHING');
  });

  it('loads occupied slots without filtering cancelled showtimes', () => {
    const start = ensureSrc.indexOf('async listOccupied');
    const end = ensureSrc.indexOf('async insertShowtimes');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const occupiedSection = ensureSrc.slice(start, end);
    expect(occupiedSection).not.toContain('cancelled_at IS NULL');
    expect(occupiedSection).toContain('row.cancelled_at');
  });

  it('reads screen prices directly from screens.price_kobo and excludes NULL prices', () => {
    const start = ensureSrc.indexOf('async listScreens');
    const end = ensureSrc.indexOf('async listOccupied');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const listScreensSection = ensureSrc.slice(start, end);
    expect(listScreensSection).toContain('price_kobo');
    expect(listScreensSection).toContain('WHERE price_kobo IS NOT NULL');
    expect(listScreensSection).toContain('FROM screens');
    expect(listScreensSection).not.toContain('showtimes');
  });

  it('registers the ensure route behind auth and dual rate limiting', () => {
    const start = routeSrc.indexOf("'/movies/:id/showtimes/ensure'");
    const section = routeSrc.slice(start);
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain('getSessionUser(request)');
    expect(section).toContain('onDemandRateLimit(request, reply, user.id)');
    expect(section).toContain("status(200)");
    expect(section).toContain("'NOT_ELIGIBLE'");
    expect(section).toContain("'TMDB_UNAVAILABLE'");
  });

  it('never logs the requesting user in the ensure route', () => {
    const start = routeSrc.indexOf("'/movies/:id/showtimes/ensure'");
    const section = routeSrc.slice(start);
    expect(section).toMatch(/request\.log\.(info|error)\(/);
    expect(section).not.toMatch(/request\.log\.(info|error)\([^)]*user\.id/s);
  });

  it('uses no random source and no hashing in the new ensure modules', () => {
    expect(ensureSrc).not.toContain('Math.random');
    expect(ensureSrc).not.toContain('createHash');
    expect(routeSrc).not.toContain('Math.random');
  });

  it('takes a transaction client from the writer pool and always releases it', () => {
    expect(routeSrc).toContain('writerPool.connect()');
    expect(routeSrc).toContain('client.release()');
  });
});
