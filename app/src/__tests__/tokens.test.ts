import { describe, expect, it } from 'vitest';
import {
  BrandColors,
  DarkColors,
  FontFamilies,
  LightColors,
  Radius,
  Spacing,
  Typography,
} from '../tokens';

describe('A VUE Design Tokens Audit', () => {
  it('contains required brand colors without alterations', () => {
    expect(BrandColors.forestGreen).toBe('#015D47');
    expect(BrandColors.crestYellow).toBe('#E0F354');
    expect(BrandColors.mandarinOrange).toBe('#FD550A');
  });

  it('contains light and dark palettes matching design tokens', () => {
    // Primary pinned to #FD550A
    expect(LightColors.primary).toBe('#FD550A');
    expect(DarkColors.primary).toBe('#FD550A');

    // On primary is black (#000000) per design token deviation
    expect(LightColors.on_primary).toBe('#000000');
    expect(DarkColors.on_primary).toBe('#000000');

    // Surface
    expect(LightColors.surface).toBe('#FFF4F1');
    expect(DarkColors.surface).toBe('#1A110F');

    // Secondary & Success
    expect(LightColors.secondary).toBe('#1B6A54');
    expect(DarkColors.secondary).toBe('#8BD5B9');
    expect(LightColors.success).toBe('#1B6A54');
    expect(DarkColors.success).toBe('#8BD5B9');
  });

  it('matches adaptive icon background to dark surface token', () => {
    // The mark file background is #1A110F
    const markBackgroundHex = '#1A110F';
    expect(DarkColors.surface).toBe(markBackgroundHex);
  });

  it('contains typography tokens for Red Hat Display and Inter', () => {
    expect(FontFamilies.primary).toBe('Red Hat Display');
    expect(FontFamilies.secondary).toBe('Inter');

    expect(Typography.displayLarge.fontFamily).toBe('Red Hat Display');
    expect(Typography.displayLarge.fontSize).toBe(62);
    expect(Typography.bodyLarge.fontFamily).toBe('Inter');
    expect(Typography.bodyLarge.fontSize).toBe(16);
  });

  it('uses standard multiples of 4/8 for spacing', () => {
    expect(Spacing.none).toBe(0);
    expect(Spacing.xs).toBe(4);
    expect(Spacing.sm).toBe(8);
    expect(Spacing.md).toBe(12);
    expect(Spacing.base).toBe(16);
    expect(Spacing.lg).toBe(20);
    expect(Spacing.xl).toBe(24);
    expect(Spacing.xxl).toBe(32);
  });

  it('contains standard radius values from design tokens', () => {
    expect(Radius.none).toBe(0);
    expect(Radius.sm).toBe(8);
    expect(Radius.md).toBe(12);
    expect(Radius.lg).toBe(16);
    expect(Radius.xl).toBe(28);
    expect(Radius.full).toBe(9999);
  });

  it('verifies error tokens exist and meet WCAG AA contrast ratio >= 4.5:1 against surface background in light and dark modes (Task 2)', () => {
    expect(LightColors.error).toBe('#BA1A1A');
    expect(DarkColors.error).toBe('#FFB4AB');

    function getRelativeLuminance(hex: string): number {
      const rgb = hex.replace('#', '').match(/.{2}/g)!.map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function calculateContrastRatio(foreground: string, background: string): number {
      const lumForeground = getRelativeLuminance(foreground);
      const lumBackground = getRelativeLuminance(background);
      const lighter = Math.max(lumForeground, lumBackground);
      const darker = Math.min(lumForeground, lumBackground);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // Light mode: error text (#BA1A1A) on surface background (#FFF4F1)
    const lightContrast = calculateContrastRatio(LightColors.error, LightColors.surface);
    expect(lightContrast).toBeGreaterThanOrEqual(4.5);

    // Dark mode: error text (#FFB4AB) on surface background (#1A110F)
    const darkContrast = calculateContrastRatio(DarkColors.error, DarkColors.surface);
    expect(darkContrast).toBeGreaterThanOrEqual(4.5);
  });
});
