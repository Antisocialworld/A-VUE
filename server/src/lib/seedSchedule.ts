/**
 * Pure, deterministic schedule maths for the cinema seed script.
 *
 * No clock reads, no randomness, no database access: callers pass the halls,
 * movie IDs, and Lagos calendar days in, and get showtime rows back.
 *
 * Layout (the seed supplies 3 seeded screens and 3 slots per day):
 * - Movies: the first SEED_MOVIE_COUNT ids in the order the script loaded them.
 * - Screens: halls with is_seeded = true (exactly SEED_SCREEN_COUNT).
 * - Slots: 13:00, 16:30, 20:00 Africa/Lagos (+01:00).
 * - Cells per day: screens * slots = 3 * 3 = 9.
 * - Movie: movieIds[(slotIdx + screenIdx + dayIdx) % movieIds.length].
 *
 * Consequences with exactly 3 movies and 3 seeded screens:
 * - The same movie is never placed on two screens at the same start time.
 * - Every movie plays in every slot each day, on 3 different screens per day.
 * - Each day uses all 3 seeded screens, so both cinemas appear.
 *
 * Free (is_seeded = false) screens get no seeded showtimes.
 */

export const SEED_MOVIE_COUNT = 3;
export const SEED_SCREEN_COUNT = 3;

export interface SeedScheduleHall {
  id: string;
  cinemaId: string;
  priceKobo: number;
}

export interface SeededScheduleHall extends SeedScheduleHall {
  isSeeded: boolean;
}

export interface SeedScheduleDay {
  dateStr: string; // YYYY-MM-DD (Africa/Lagos calendar date)
  times: string[]; // HH:MM (Africa/Lagos)
}

export interface SeedShowtimeRow {
  movieId: string;
  screenId: string;
  startsAt: string; // ISO 8601 with +01:00
  priceKobo: number;
}

/**
 * Selects halls marked is_seeded = true for deterministic seed scheduling.
 * Requires exactly SEED_SCREEN_COUNT seeded halls; fails loudly otherwise.
 * Returned in id order for stable slot-to-screen assignment.
 */
export function selectSeededScreens<T extends SeededScheduleHall>(
  halls: readonly T[],
): T[] {
  const seeded = halls.filter((hall) => hall.isSeeded);
  if (seeded.length !== SEED_SCREEN_COUNT) {
    throw new Error(
      `Expected exactly ${SEED_SCREEN_COUNT} seeded screens (is_seeded = true), found ${seeded.length}.`,
    );
  }
  return Array.from(seeded).sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.cinemaId !== b.cinemaId) return a.cinemaId < b.cinemaId ? -1 : 1;
    return a.priceKobo - b.priceKobo;
  });
}

/**
 * Builds the full showtime row list. Pure: identical arguments always produce
 * identical rows.
 */
export function buildSeedShowtimes(
  movieIds: readonly string[],
  screens: readonly SeedScheduleHall[],
  schedule: readonly SeedScheduleDay[],
): SeedShowtimeRow[] {
  if (movieIds.length === 0 || screens.length === 0 || schedule.length === 0) {
    return [];
  }

  const rows: SeedShowtimeRow[] = [];

  for (let dayIdx = 0; dayIdx < schedule.length; dayIdx++) {
    const { dateStr, times } = schedule[dayIdx];

    for (let slotIdx = 0; slotIdx < times.length; slotIdx++) {
      for (let screenIdx = 0; screenIdx < screens.length; screenIdx++) {
        const movieIndex = (slotIdx + screenIdx + dayIdx) % movieIds.length;
        const screen = screens[screenIdx];

        rows.push({
          movieId: movieIds[movieIndex],
          screenId: screen.id,
          startsAt: `${dateStr}T${times[slotIdx]}:00+01:00`,
          priceKobo: screen.priceKobo,
        });
      }
    }
  }

  return rows;
}
