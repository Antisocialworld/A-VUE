import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('A VUE Seat Map Photo & Fit-to-Width Grid Contract', () => {
  const seatMapScreenPath = path.resolve(__dirname, '../screens/SeatMapScreen.tsx');
  const seatMapComponentPath = path.resolve(__dirname, '../components/SeatMap.tsx');
  const stringsPath = path.resolve(__dirname, '../constants/strings.ts');

  const screenSrc = fs.readFileSync(seatMapScreenPath, 'utf-8');
  const componentSrc = fs.readFileSync(seatMapComponentPath, 'utf-8');
  const stringsSrc = fs.readFileSync(stringsPath, 'utf-8');

  it('declares the seat map photo asset path and bottom-crop ratio in SeatMapScreen.tsx', () => {
    expect(screenSrc).toMatch(/require\(.*assets\/photos\/seat-map\.jpg.*\)/);
    // Crop container: height = windowWidth * 0.34 and overflow hidden
    expect(screenSrc).toMatch(/height:\s*windowWidth\s*\*\s*0\.34/);
    expect(screenSrc).toContain("overflow: 'hidden'");
    // Image at bottom with 1600/1203 aspect ratio
    expect(screenSrc).toContain("bottom: 0");
    expect(screenSrc).toMatch(/aspectRatio:\s*1600\s*\/\s*1203/);
  });

  it('sets photo accessibility role and label from strings.ts and pointerEvents="none"', () => {
    expect(stringsSrc).toContain('photoAccessibilityLabel:');
    expect(screenSrc).toContain('accessibilityLabel={STRINGS.seatMap.photoAccessibilityLabel}');
    expect(screenSrc).toMatch(/accessibilityRole="image"/);
    expect(screenSrc).toContain('pointerEvents="none"');
  });

  it('fades top edge into background token colour and dims photo without expo-linear-gradient', () => {
    expect(screenSrc).not.toContain('expo-linear-gradient');
    expect(screenSrc).toContain('from \'react-native-svg\'');
    expect(screenSrc).toContain('<LinearGradient id="seatMapFade"');
    expect(screenSrc).toContain('stopColor={colors.surface}');
    expect(screenSrc).toContain('backgroundColor: colors.scrim');
    expect(screenSrc).not.toContain('colors.background');
    expect(screenSrc).not.toContain('absoluteFillObject');
  });

  it('derives fit-to-width cell size from useWindowDimensions width and data row capacity (no hardcoded 10)', () => {
    expect(componentSrc).toContain('useWindowDimensions');
    expect(componentSrc).toContain('maxSeatsInRow');
    expect(componentSrc).toContain('availableSeatsWidth / maxSeatsInRow');
    // Ensure 10 is not hard-coded for row seat count
    expect(componentSrc).not.toMatch(/maxSeatsInRow\s*=\s*10/);
    expect(componentSrc).not.toMatch(/seatsPerRow\s*=\s*10/);
  });

  it('top-aligns the grid under the zoom button and centers it horizontally without vertical flex centering', () => {
    expect(componentSrc).toMatch(/gridContentContainer:\s*\{[^}]*justifyContent:\s*['"]center['"]/);
    expect(componentSrc).toMatch(/gridContentContainer:\s*\{[^}]*alignItems:\s*['"]flex-start['"]/);
    expect(componentSrc).not.toMatch(/gridContentContainer:\s*\{[^}]*alignItems:\s*['"]center['"]/);
    expect(componentSrc).toContain("justifyContent: isZoomed ? 'flex-start' : 'center'");
  });

  it('computes centered width math from real rendered width with matching label width', () => {
    expect(componentSrc).toContain('rowLabelColumnWidth = isZoomed ? 24 : 14');
    expect(componentSrc).toContain('cellWidth = Math.floor(rawSeatCellWidth)');
    expect(componentSrc).toContain('cellWidth - fitMargin * 2');
  });

  it('preserves Zoom mode toggle strings, state, and 44 pt touch targets', () => {
    expect(componentSrc).toContain("'Zoom in (44 pt targets)'");
    expect(componentSrc).toContain("'Fit scale (overview)'");
    expect(componentSrc).toContain('is44PtTarget ? 44');
    expect(componentSrc).toContain('isZoomed ? 38');
  });

  it('preserves all five seat states and seat accessibility labels', () => {
    expect(componentSrc).toContain('STRINGS.seatMap.availableLegend');
    expect(componentSrc).toContain('STRINGS.seatMap.selectedLegend');
    expect(componentSrc).toContain('STRINGS.seatMap.heldLegend');
    expect(componentSrc).toContain('STRINGS.seatMap.soldLegend');
    expect(componentSrc).toContain('STRINGS.seatMap.wheelchairLegend');
    expect(componentSrc).toContain('STRINGS.seatMap.seatAccessibilityLabel');
  });

  it('contains zero unapproved hex colour literals in SeatMapScreen.tsx and SeatMap.tsx', () => {
    for (const src of [screenSrc, componentSrc]) {
      const cleanSrc = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '');
      const hexLiterals = cleanSrc.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      const nonStandard = hexLiterals.filter(
        (h) => h.toUpperCase() !== '#000000' && h.toUpperCase() !== '#FFFFFF'
      );
      expect(nonStandard).toEqual([]);
    }
  });
});
