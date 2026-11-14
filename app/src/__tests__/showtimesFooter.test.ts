import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('A VUE Showtimes Footer Photo & Lettering Watermark Contract', () => {
  const showtimesScreenPath = path.resolve(__dirname, '../screens/ShowtimesScreen.tsx');
  const stringsPath = path.resolve(__dirname, '../constants/strings.ts');

  const showtimesSrc = fs.readFileSync(showtimesScreenPath, 'utf-8');
  const stringsSrc = fs.readFileSync(stringsPath, 'utf-8');

  it('declares the footer photo asset path with 1400:764 aspect ratio', () => {
    expect(showtimesSrc).toMatch(/require\(.*assets\/photos\/showtimes\.jpg.*\)/);
    expect(showtimesSrc).toMatch(/aspectRatio:\s*1400\s*\/\s*764/);
    expect(showtimesSrc).toContain("marginTop: 'auto'");
  });

  it('sets footer photo accessibility role and label from strings.ts', () => {
    expect(stringsSrc).toContain('footerPhotoAccessibilityLabel:');
    expect(showtimesSrc).toContain('accessibilityLabel={STRINGS.showtimes.footerPhotoAccessibilityLabel}');
    expect(showtimesSrc).toMatch(/accessibilityRole="image"/);
  });

  it('fades the top edge into background token colour using react-native-svg LinearGradient without expo-linear-gradient', () => {
    expect(showtimesSrc).not.toContain('expo-linear-gradient');
    expect(showtimesSrc).toContain('from \'react-native-svg\'');
    expect(showtimesSrc).toContain('<LinearGradient id="showtimesTopFade"');
    expect(showtimesSrc).toContain('stopColor={colors.surface}');
    expect(showtimesSrc).not.toContain('colors.background');
    expect(showtimesSrc).not.toContain('absoluteFillObject');
  });

  it('dims the footer photo with a token colour overlay and pointerEvents="none"', () => {
    expect(showtimesSrc).toContain('pointerEvents="none"');
    expect(showtimesSrc).toContain('backgroundColor: colors.scrim');
    expect(showtimesSrc).toMatch(/opacity:\s*0\.35/);
  });

  it('draws A VUE lettering watermark in code reusing WORDMARK_PATHS and primary 80 token', () => {
    expect(showtimesSrc).toContain("import { WORDMARK_BOX, WORDMARK_PATHS } from '../components/Wordmark'");
    expect(showtimesSrc).toContain("colorData.palettes.primary['80']");
    expect(showtimesSrc).toContain('width={120}');
    expect(showtimesSrc).toMatch(/opacity:\s*0\.2/);
    expect(showtimesSrc).toContain('accessible={false}');
    expect(showtimesSrc).toContain('accessibilityElementsHidden={true}');
    expect(showtimesSrc).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it('contains zero unapproved hex colour literals in ShowtimesScreen.tsx', () => {
    // Strips comments
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
