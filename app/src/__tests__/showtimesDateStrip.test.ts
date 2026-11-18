import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildDateOptions, toLocalDateKey } from '../utils/date';
import { STRINGS } from '../constants/strings';
import { DarkColors, LightColors } from '../tokens';

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

describe('Task D: date strip availability', () => {
  const showtimesScreenPath = path.resolve(__dirname, '../screens/ShowtimesScreen.tsx');
  const showtimesSrc = fs.readFileSync(showtimesScreenPath, 'utf-8');

  const stripStart = showtimesSrc.indexOf('{dateOptions.map((opt) => {');
  const stripEnd = showtimesSrc.indexOf('</ScrollView>', stripStart);
  const stripSection = showtimesSrc.slice(stripStart, stripEnd);

  it('dims chips with no showtimes using existing colour tokens, not opacity', () => {
    expect(stripStart).toBeGreaterThan(-1);
    expect(stripEnd).toBeGreaterThan(stripStart);

    expect(stripSection).toContain('const hasShowtimes = datesWithShowtimes.has(opt.dateStr)');
    expect(stripSection).toContain('const isDimmed = !hasShowtimes && !isSelected');
    expect(stripSection).toContain('colors.surface_container_lowest');
    expect(stripSection).toContain('colors.outline');

    // No opacity hack and no literal colour values in the chips.
    expect(stripSection).not.toContain('opacity');
    expect(stripSection).not.toMatch(/#[0-9A-Fa-f]{3,8}/);

    // The dimming roles already exist in both standard theme modes.
    for (const tokens of [LightColors, DarkColors]) {
      expect(tokens).toHaveProperty('surface_container_lowest');
      expect(tokens).toHaveProperty('outline');
      expect(tokens).toHaveProperty('primary');
      expect(tokens).toHaveProperty('on_primary');
    }
  });

  it('keeps dimmed chips tappable so the empty-day message still shows', () => {
    expect(stripSection).toContain('onPress={() => handleSelectDate(opt.dateStr)}');
    expect(stripSection).not.toContain('disabled');
    expect(showtimesSrc).toContain('STRINGS.showtimes.noShowtimesDayTitle');
    expect(showtimesSrc).toContain('STRINGS.showtimes.noShowtimesDayMessage');
  });

  it('selects the first day with showtimes unless the user has tapped a day', () => {
    expect(showtimesSrc).toContain('const userSelectedDateRef = useRef<boolean>(false)');
    expect(showtimesSrc).toContain('userSelectedDateRef.current = true;');
    expect(showtimesSrc).toMatch(
      /useEffect\(\(\) => \{\s*if \(userSelectedDateRef\.current\) return;/,
    );
    expect(showtimesSrc).toContain(
      'const firstAvailable = dateOptions.find((opt) => datesWithShowtimes.has(opt.dateStr));',
    );
    expect(showtimesSrc).toContain('setSelectedDateStr(firstAvailable.dateStr);');

    // A tapped day wins from then on.
    const tapStart = showtimesSrc.indexOf('const handleSelectDate');
    const tapEnd = showtimesSrc.indexOf('}, []);', tapStart);
    const tapSection = showtimesSrc.slice(tapStart, tapEnd);
    expect(tapSection.indexOf('userSelectedDateRef.current = true;')).toBeLessThan(
      tapSection.indexOf('setSelectedDateStr(dateStr);'),
    );
  });

  it('re-evaluates the selection after the ensure flow refetches showtimes', () => {
    expect(showtimesSrc).toContain('setShowtimes(data.showtimes);');
    expect(showtimesSrc).toMatch(
      /const datesWithShowtimes = useMemo\(\(\) => \{[\s\S]*?keys\.add\(toLocalDateKey\(st\.startsAt\)\);[\s\S]*?\}, \[showtimes\]\);/,
    );
    expect(showtimesSrc).toContain('}, [dateOptions, datesWithShowtimes]);');
  });

  it('announces showtime availability in every chip accessibility label', () => {
    expect(showtimesSrc).toContain(
      'STRINGS.showtimes.dateChipAccessibilityLabel(',
    );
    expect(showtimesSrc).toContain('hasShowtimes,');
    expect(showtimesSrc).not.toContain('`${opt.dayLabel}, ${opt.dateNum}`');

    expect(STRINGS.showtimes.dateChipAccessibilityLabel('Today', 18, true)).toBe(
      'Today, 18. Showtimes available.',
    );
    expect(STRINGS.showtimes.dateChipAccessibilityLabel('Today', 18, false)).toBe(
      'Today, 18. No showtimes.',
    );
    expect(STRINGS.showtimes.dateChipAccessibilityLabel('Mon', 23, true)).not.toContain(
      'please',
    );
  });
});
