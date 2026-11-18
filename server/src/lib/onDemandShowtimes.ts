/**
 * Pure, deterministic on-demand showtime planner.
 * Rules:
 * - Deterministic arithmetic scheduling (no random source, no hashing).
 * - Horizon: Africa/Lagos calendar days (UTC+1, no DST).
 * - Mon-Fri: 13:00, 16:30, 20:00 (+01:00).
 * - Sat-Sun: 10:30, 13:45, 17:00, 20:15 (+01:00).
 * - 3-hour blocks per screen. A candidate is blocked when its block overlaps
 *   the block of any existing showtime on that screen (interval overlap, not
 *   exact-start equality). Cancelled rows still block.
 * - Lead time: skip slots starting less than minLeadMinutes from now.
 * - Eligible: movie release date must not be after horizon end.
 * - Never schedule slots before movie release date.
 * - Distribute deterministically starting at (movieId + dayIndex) mod screenCount.
 * - Caps: capped by maxShowtimesPerMovie and slotsPerMoviePerDay.
 * - Screens and integer kobo prices are supplied by the caller (loaded from the DB).
 *   This module deliberately holds no screen IDs or prices.
 */

export interface ScreenDefinition {
  id: string;
  cinemaId: string;
  name: string;
  priceKobo: number;
}

export interface ExistingShowtimeItem {
  screenId: string;
  startsAt: string | Date;
  /** Cancelled showtimes are still passed in: they keep the (screen_id, starts_at) slot. */
  cancelled?: boolean;
}

export interface PlannedShowtime {
  movieId: string;
  screenId: string;
  startsAt: string;
  priceKobo: number;
  source: 'on_demand';
}

export interface PlanOnDemandParams {
  movieId: string | number;
  releaseDate?: string | null; // YYYY-MM-DD
  now: Date;
  existingShowtimes: ExistingShowtimeItem[];
  horizonDays?: number; // default 7
  minLeadMinutes?: number; // default 60
  slotsPerMoviePerDay?: number; // default 2
  maxShowtimesPerMovie?: number; // default 30
  existingMovieShowtimesCount?: number; // default 0
  screens: ScreenDefinition[]; // required: route loads these from the DB
}

export interface LagosCalendarDay {
  dateStr: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
const THREE_HOURS_MS = 3 * 60 * 60 * 1000; // 180 min block per showtime

/**
 * Interval overlap for two 3-hour showtime blocks.
 *
 * A slot is blocked when [existingStart, existingEnd) intersects
 * [candidateStart, candidateEnd): existingStart < candidateEnd AND
 * candidateStart < existingEnd. Touching blocks (exactly 3 hours apart) do not
 * overlap, so a 13:00 show blocks 10:30 and 13:45 but not 16:00 or 17:00.
 *
 * Cancelled showtimes run through the same check: they still hold their
 * (screen_id, starts_at) slot and its 3-hour footprint.
 */
export function showtimeBlocksOverlap(
  existingStartsAtMs: number,
  candidateStartsAtMs: number,
  blockMs: number = THREE_HOURS_MS,
): boolean {
  const existingEndMs = existingStartsAtMs + blockMs;
  const candidateEndMs = candidateStartsAtMs + blockMs;
  return existingStartsAtMs < candidateEndMs && candidateStartsAtMs < existingEndMs;
}

/**
 * Calculates calendar days in Africa/Lagos timezone (+01:00).
 * Handles month and year transitions and midnight boundaries.
 */
export function getLagosHorizonDays(now: Date, horizonDays: number): LagosCalendarDay[] {
  const lagosNow = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const baseYear = lagosNow.getUTCFullYear();
  const baseMonth = lagosNow.getUTCMonth();
  const baseDay = lagosNow.getUTCDate();

  const days: LagosCalendarDay[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(Date.UTC(baseYear, baseMonth, baseDay + i));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    days.push({
      dateStr: `${year}-${mm}-${dd}`,
      year,
      month,
      day,
      dayOfWeek: d.getUTCDay(),
    });
  }
  return days;
}

/**
 * Eligibility rule: a movie releasing after the last Lagos horizon day is not eligible.
 * An empty release date is treated as eligible (unknown release date).
 */
export function isMovieEligibleForHorizon(
  releaseDate: string | null | undefined,
  now: Date,
  horizonDays: number,
): boolean {
  if (!releaseDate || releaseDate.trim().length === 0) {
    return true;
  }
  const horizon = getLagosHorizonDays(now, horizonDays);
  if (horizon.length === 0) {
    return false;
  }
  return releaseDate.trim() <= horizon[horizon.length - 1].dateStr;
}

/**
 * Converts Lagos slot time (YYYY-MM-DD and HH:MM) into UTC epoch milliseconds.
 * Since Lagos is UTC+1, UTC hour is slotHour - 1.
 */
export function lagosSlotToUtcMs(
  year: number,
  month: number,
  day: number,
  timeStr: string,
): number {
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));
  const hour = parts[0];
  const minute = parts[1] || 0;
  return Date.UTC(year, month - 1, day, hour - 1, minute);
}

/**
 * Pure, deterministic on-demand showtime planner function.
 */
export function planOnDemandShowtimes(params: PlanOnDemandParams): PlannedShowtime[] {
  const {
    movieId,
    releaseDate,
    now,
    existingShowtimes,
    horizonDays = 7,
    minLeadMinutes = 60,
    slotsPerMoviePerDay = 2,
    maxShowtimesPerMovie = 30,
    existingMovieShowtimesCount = 0,
    screens,
  } = params;

  if (screens.length === 0 || horizonDays <= 0 || slotsPerMoviePerDay <= 0) {
    return [];
  }

  // Already reached cap for this movie
  if (existingMovieShowtimesCount >= maxShowtimesPerMovie) {
    return [];
  }

  const horizon = getLagosHorizonDays(now, horizonDays);
  if (horizon.length === 0) {
    return [];
  }

  const lastHorizonDate = horizon[horizon.length - 1].dateStr;

  // Eligibility check: If movie release date is strictly after horizon end, create nothing
  if (releaseDate && releaseDate.trim().length > 0) {
    const cleanReleaseDate = releaseDate.trim();
    if (cleanReleaseDate > lastHorizonDate) {
      return [];
    }
  }

  // Index existing showtimes by screenId for fast interval-overlap checks.
  // Cancelled showtimes stay in the occupied set on purpose: they still hold the
  // (screen_id, starts_at) unique slot in the database and its 3-hour block.
  const occupiedByScreen = new Map<string, number[]>();
  for (const screen of screens) {
    occupiedByScreen.set(screen.id, []);
  }

  for (const st of existingShowtimes) {
    const ms = typeof st.startsAt === 'string' ? new Date(st.startsAt).getTime() : st.startsAt.getTime();
    const list = occupiedByScreen.get(st.screenId);
    if (list) {
      list.push(ms);
    }
  }

  function isConflicting(screenId: string, candidateMs: number): boolean {
    const occupied = occupiedByScreen.get(screenId);
    if (!occupied) return false;
    for (const occ of occupied) {
      if (showtimeBlocksOverlap(occ, candidateMs)) {
        return true;
      }
    }
    return false;
  }

  function markOccupied(screenId: string, candidateMs: number) {
    const occupied = occupiedByScreen.get(screenId);
    if (occupied) {
      occupied.push(candidateMs);
    }
  }

  const nowMs = now.getTime();
  const minLeadMs = minLeadMinutes * 60 * 1000;
  const numericMovieId = typeof movieId === 'number'
    ? movieId
    : parseInt(String(movieId).replace(/\D/g, ''), 10) || 0;

  const planned: PlannedShowtime[] = [];
  let currentTotalMovieShowtimes = existingMovieShowtimesCount;

  for (let dayIndex = 0; dayIndex < horizon.length; dayIndex++) {
    if (currentTotalMovieShowtimes >= maxShowtimesPerMovie) {
      break;
    }

    const day = horizon[dayIndex];

    // Never schedule before release date
    if (releaseDate && releaseDate.trim().length > 0) {
      if (day.dateStr < releaseDate.trim()) {
        continue;
      }
    }

    // Mon-Fri: 13:00, 16:30, 20:00. Sat-Sun: 10:30, 13:45, 17:00, 20:15
    const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6;
    const daySlotTimes = isWeekend
      ? ['10:30', '13:45', '17:00', '20:15']
      : ['13:00', '16:30', '20:00'];

    let slotsTakenToday = 0;
    const screenCount = screens.length;
    const startScreenIndex = ((numericMovieId + dayIndex) % screenCount + screenCount) % screenCount;

    // Pass 1: Try to distribute across distinct screens starting at (movieId + dayIndex) mod count
    for (let s = 0; s < screenCount && slotsTakenToday < slotsPerMoviePerDay; s++) {
      if (currentTotalMovieShowtimes >= maxShowtimesPerMovie) break;

      const screen = screens[(startScreenIndex + s) % screenCount];

      for (const timeStr of daySlotTimes) {
        if (slotsTakenToday >= slotsPerMoviePerDay) break;
        if (currentTotalMovieShowtimes >= maxShowtimesPerMovie) break;

        const candidateUtcMs = lagosSlotToUtcMs(day.year, day.month, day.day, timeStr);

        // Lead time rule: skip slots starting less than minLeadMinutes from now
        if (candidateUtcMs - nowMs < minLeadMs) {
          continue;
        }

        // Overlap rule: 3-hour block per screen
        if (isConflicting(screen.id, candidateUtcMs)) {
          continue;
        }

        // Slot is free and eligible
        planned.push({
          movieId: String(movieId),
          screenId: screen.id,
          startsAt: `${day.dateStr}T${timeStr}:00+01:00`,
          priceKobo: screen.priceKobo,
          source: 'on_demand',
        });

        markOccupied(screen.id, candidateUtcMs);
        slotsTakenToday++;
        currentTotalMovieShowtimes++;
        break; // Advance to next screen to spread allocation
      }
    }

    // Pass 2: If capacity remains today and some screens have additional non-conflicting slots, fill up to slotsPerMoviePerDay
    if (slotsTakenToday < slotsPerMoviePerDay && currentTotalMovieShowtimes < maxShowtimesPerMovie) {
      for (let s = 0; s < screenCount && slotsTakenToday < slotsPerMoviePerDay; s++) {
        if (currentTotalMovieShowtimes >= maxShowtimesPerMovie) break;

        const screen = screens[(startScreenIndex + s) % screenCount];

        for (const timeStr of daySlotTimes) {
          if (slotsTakenToday >= slotsPerMoviePerDay) break;
          if (currentTotalMovieShowtimes >= maxShowtimesPerMovie) break;

          const candidateUtcMs = lagosSlotToUtcMs(day.year, day.month, day.day, timeStr);

          if (candidateUtcMs - nowMs < minLeadMs) {
            continue;
          }

          if (isConflicting(screen.id, candidateUtcMs)) {
            continue;
          }

          planned.push({
            movieId: String(movieId),
            screenId: screen.id,
            startsAt: `${day.dateStr}T${timeStr}:00+01:00`,
            priceKobo: screen.priceKobo,
            source: 'on_demand',
          });

          markOccupied(screen.id, candidateUtcMs);
          slotsTakenToday++;
          currentTotalMovieShowtimes++;
        }
      }
    }
  }

  return planned;
}
