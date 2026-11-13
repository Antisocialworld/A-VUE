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
});
