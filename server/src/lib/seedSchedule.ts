/**
 * Pure, deterministic schedule maths for the cinema seed script.
 *
 * No clock reads, no randomness, no database access: callers pass the halls,
 * movie IDs, and Lagos calendar days in, and get showtime rows back.
 *
 * Layout (the seed supplies 2 screens and 3 slots per day):
 * - Screens: exactly one per cinema, the lowest-id screen from SEED_HALLS.
 * - Slots: 13:00, 16:30, 20:00 Africa/Lagos (+01:00).
 * - Cells per day: screens * slots = 2 * 3 = 6.
 * - Cell index: c = slotIdx * screenCount + screenIdx, which is exactly
 *   c = slotIdx * 2 + screenIdx for the seed's two screens.
 * - Movie: movieIds[(d * cellsPerDay + c) % movieIds.length].
 *
 * Consequences:
 * - The same movie is never placed on two screens at the same start time
 *   (adjacent cell indices are distinct modulo any movie count >= 2).
 * - When movieIds.length <= cellsPerDay (6), every movie gets at least one
 *   slot every day. With the seed's six-movie rotation, each day shows each
 *   movie exactly once. With more than six movies, six daily cells cannot
 *   include every movie daily.
 */

export interface SeedScheduleHall {
  id: string;
  cinemaId: string;
  priceKobo: number;
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
 * Picks the lowest-id screen per cinema, in deterministic id order.
 * The seed's halls share a common prefix and differ in the final digit, so
 * lexicographic string comparison is the id order.
 */
export function selectLowestIdScreenPerCinema<T extends SeedScheduleHall>(
  halls: readonly T[],
): T[] {
  const selected = new Map<string, T>();

  for (const hall of halls) {
    const current = selected.get(hall.cinemaId);
    if (!current || hall.id < current.id) {
      selected.set(hall.cinemaId, hall);
    }
  }

  return Array.from(selected.values()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
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

  const slotsPerDay = schedule[0].times.length;
  const cellsPerDay = screens.length * slotsPerDay;
  if (cellsPerDay === 0) {
    return [];
  }

  const rows: SeedShowtimeRow[] = [];

  for (let d = 0; d < schedule.length; d++) {
    const { dateStr, times } = schedule[d];

    for (let slotIdx = 0; slotIdx < times.length; slotIdx++) {
      for (let screenIdx = 0; screenIdx < screens.length; screenIdx++) {
        const cellIndex = slotIdx * screens.length + screenIdx;
        const movieIndex = (d * cellsPerDay + cellIndex) % movieIds.length;
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
