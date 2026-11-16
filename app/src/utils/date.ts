/**
 * A VUE Date Utilities
 * Formats a Date instance or ISO 8601 string to a local YYYY-MM-DD key
 * using the device's local calendar date (getFullYear, getMonth, getDate).
 * Rule 01 (Agent Rules), Rule 06 (UI)
 */

import { STRINGS } from '../constants/strings';

export interface DateOption {
  dateStr: string; // YYYY-MM-DD in local timezone
  dayLabel: string; // "Today", "Tomorrow", "Mon", etc.
  dateNum: number; // Day of month (1-31)
}

/**
 * Returns a local YYYY-MM-DD key from a Date object or ISO string.
 * Uses the device's local timezone (getFullYear, getMonth, getDate)
 * so date strip keys, showtimes filtering, and displayed hours
 * all stay synchronized with the device's clock.
 */
export function toLocalDateKey(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Builds the 7-day date strip options starting from baseDate (default: new Date()).
 * Labels: 'Today' (day 0), 'Tomorrow' (day 1), short day name (day 2-6).
 */
export function buildDateOptions(baseDate: Date = new Date()): DateOption[] {
  const list: DateOption[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + i);

    const dateStr = toLocalDateKey(d);

    let dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
    if (i === 0) dayLabel = STRINGS.showtimes.dateToday;
    if (i === 1) dayLabel = STRINGS.showtimes.dateTomorrow;

    list.push({
      dateStr,
      dayLabel,
      dateNum: d.getDate(),
    });
  }

  return list;
}
