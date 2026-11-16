import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildDateOptions, toLocalDateKey } from '../utils/date';
import { STRINGS } from '../constants/strings';

describe('A VUE Showtimes Date Strip & Local Date Handling Contract', () => {
  const showtimesScreenPath = path.resolve(__dirname, '../screens/ShowtimesScreen.tsx');
  const dateUtilPath = path.resolve(__dirname, '../utils/date.ts');

  const showtimesSrc = fs.readFileSync(showtimesScreenPath, 'utf-8');
  const dateUtilSrc = fs.readFileSync(dateUtilPath, 'utf-8');

  it('ShowtimesScreen rebuilds date strip on focus and AppState active', () => {
    // Listens for focus via isFocused prop / mount effect
    expect(showtimesSrc).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*isFocused\s*\)\s*\{[\s\S]*?refreshDateOptions\(\)/);

    // Listens for AppState change and rebuilds when state becomes 'active'
    expect(showtimesSrc).toContain("AppState.addEventListener('change'");
    expect(showtimesSrc).toMatch(/if\s*\(\s*nextState\s*===\s*['"]active['"]\s*\)\s*\{[\s\S]*?refreshDateOptions\(\)/);

    // If previous selected date is not in rebuilt options, selects first date
    expect(showtimesSrc).toContain('newOptions.some((opt) => opt.dateStr === prevSelected)');
    expect(showtimesSrc).toContain('newOptions[0]?.dateStr');
  });

  it('showtime filter no longer uses split("T")', () => {
    // The showtime filter does not extract date via split('T')
    expect(showtimesSrc).not.toContain("st.startsAt.split('T')");
    expect(showtimesSrc).not.toContain('split("T")');
  });

  it('both the strip builder and showtime filter use the shared toLocalDateKey helper', () => {
    // ShowtimesScreen imports toLocalDateKey from ../utils/date
    expect(showtimesSrc).toContain("import { buildDateOptions, DateOption, toLocalDateKey } from '../utils/date'");

    // Filter uses toLocalDateKey
    expect(showtimesSrc).toMatch(/toLocalDateKey\(st\.startsAt\)\s*===\s*selectedDateStr/);

    // Date util uses toLocalDateKey inside buildDateOptions
    expect(dateUtilSrc).toContain('const dateStr = toLocalDateKey(d)');
  });

  it('toLocalDateKey formats Date and ISO strings using local calendar methods', () => {
    expect(dateUtilSrc).toContain('d.getFullYear()');
    expect(dateUtilSrc).toContain('d.getMonth() + 1');
    expect(dateUtilSrc).toContain('d.getDate()');

    const testDate = new Date(2026, 10, 16); // Local Nov 16, 2026
    expect(toLocalDateKey(testDate)).toBe('2026-11-16');
  });

  it('buildDateOptions builds a 7-day strip with Today and Tomorrow labels', () => {
    const baseDate = new Date(2026, 10, 16); // Local Nov 16, 2026
    const options = buildDateOptions(baseDate);

    expect(options).toHaveLength(7);
    expect(options[0].dateStr).toBe('2026-11-16');
    expect(options[0].dayLabel).toBe(STRINGS.showtimes.dateToday);
    expect(options[0].dateNum).toBe(16);

    expect(options[1].dateStr).toBe('2026-11-17');
    expect(options[1].dayLabel).toBe(STRINGS.showtimes.dateTomorrow);
    expect(options[1].dateNum).toBe(17);
  });
});
