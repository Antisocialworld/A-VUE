import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('A VUE Showtimes Cinema Card Images Contract (Task 2)', () => {
  const showtimesScreenPath = path.resolve(__dirname, '../screens/ShowtimesScreen.tsx');
  const stringsPath = path.resolve(__dirname, '../constants/strings.ts');

  const showtimesSrc = fs.readFileSync(showtimesScreenPath, 'utf-8');
  const stringsSrc = fs.readFileSync(stringsPath, 'utf-8');

  it('declares all 4 cinema-card image asset requires', () => {
    expect(showtimesSrc).toContain("require('../../assets/photos/cinema-card-1.jpg')");
    expect(showtimesSrc).toContain("require('../../assets/photos/cinema-card-2.jpg')");
    expect(showtimesSrc).toContain("require('../../assets/photos/cinema-card-3.jpg')");
    expect(showtimesSrc).toContain("require('../../assets/photos/cinema-card-4.jpg')");
  });

  it('selects the image by modulo 4 on sorted cinema id index', () => {
    expect(showtimesSrc).toContain('sortedCinemaIds.indexOf(group.cinemaId)');
    expect(showtimesSrc).toMatch(/\(cinemaIndex\s*>=\s*0\s*\?\s*cinemaIndex\s*:\s*0\)\s*%\s*4/);
    expect(showtimesSrc).toContain('a.localeCompare(b)');
  });

  it('sets pointerEvents="none" and accessibility properties from strings.ts', () => {
    expect(stringsSrc).toContain('cinemaCardPhotoAccessibilityLabel:');
    expect(showtimesSrc).toContain('accessibilityLabel={STRINGS.showtimes.cinemaCardPhotoAccessibilityLabel}');
    expect(showtimesSrc).toMatch(/accessibilityRole="image"/);
    expect(showtimesSrc).toContain('pointerEvents="none"');
  });

  it('feathers card image edges into card background token without expo-linear-gradient', () => {
    expect(showtimesSrc).not.toContain('expo-linear-gradient');
    expect(showtimesSrc).toContain('stopColor={colors.surface_container_low}');
    expect(showtimesSrc).toContain('styles.cardPhotoContainer');
    expect(showtimesSrc).toMatch(/opacity:\s*0\.6/);
  });

  it('contains zero unapproved hex colour literals in ShowtimesScreen.tsx', () => {
    const cleanSrc = showtimesSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    const hexLiterals = cleanSrc.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const nonStandard = hexLiterals.filter(
      (h) => h.toUpperCase() !== '#000000' && h.toUpperCase() !== '#FFFFFF'
    );
    expect(nonStandard).toEqual([]);
  });
});
