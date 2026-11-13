import { describe, expect, it } from 'vitest';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';
import { DarkColors, LightColors } from '../tokens';

/**
 * Standard WCAG 2.1 relative luminance calculation
 */
function getRelativeLuminance(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g)!.map((c) => parseInt(c, 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Standard WCAG 2.1 contrast ratio calculation
 */
function calculateContrastRatio(color1: string, color2: string): number {
  const lum1 = getRelativeLuminance(color1);
  const lum2 = getRelativeLuminance(color2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Design Contrast Audit (Task 5b)', () => {
  it('computes contrast for the name on the panel and asserts minimum 4.5:1', () => {
    // Name: palette primary 80 (#FFCEBE)
    // Panel: palette neutral 6 / dark surface (#1A110F)
    const nameColor = colorData.palettes.primary['80'];
    const panelColor = colorData.palettes.neutral_extra_tones['6'];

    const contrast = calculateContrastRatio(nameColor, panelColor);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('computes contrast for Sign up border (>= 3:1) and label (>= 4.5:1) in dark theme', () => {
    const darkSurface = DarkColors.surface; // #1A110F
    const darkSignUpBorder = colorData.palettes.primary['80']; // #FFCEBE
    const darkSignUpLabel = colorData.palettes.primary['80']; // #FFCEBE

    const borderContrast = calculateContrastRatio(darkSignUpBorder, darkSurface);
    const labelContrast = calculateContrastRatio(darkSignUpLabel, darkSurface);

    expect(borderContrast).toBeGreaterThanOrEqual(3.0);
    expect(labelContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('computes contrast for Sign up border (>= 3:1) and label (>= 4.5:1) in light theme', () => {
    const lightSurface = LightColors.surface; // #FFF4F1
    // Border uses Tone 30 (#BE3C00) — the primary tone nearest primary 40 computing >= 3:1 on light surface
    const lightSignUpBorder = colorData.palettes.primary['30']; // #BE3C00
    const lightSignUpLabel = LightColors.on_surface; // #231917

    const borderContrast = calculateContrastRatio(lightSignUpBorder, lightSurface);
    const labelContrast = calculateContrastRatio(lightSignUpLabel, lightSurface);

    expect(borderContrast).toBeGreaterThanOrEqual(3.0);
    expect(labelContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('computes contrast for Sign out color in dark theme (>= 4.5:1) and light theme (>= 4.5:1)', () => {
    // Dark theme: Tone 60 (#FF5449) on dark surface (#1A110F)
    const darkSignOutColor = colorData.palettes.error['60'];
    const darkContrast = calculateContrastRatio(darkSignOutColor, DarkColors.surface);
    expect(darkContrast).toBeGreaterThanOrEqual(4.5);

    // Light theme: LightColors.error (#BA1A1A) on light surface (#FFF4F1)
    const lightSignOutColor = LightColors.error;
    const lightContrast = calculateContrastRatio(lightSignOutColor, LightColors.surface);
    expect(lightContrast).toBeGreaterThanOrEqual(4.5);
  });
});

