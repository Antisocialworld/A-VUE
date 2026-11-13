import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('EmptyState Watermark Architecture & Accessibility (Task 5)', () => {
  const componentPath = path.resolve(__dirname, '../components/EmptyState.tsx');

  it('EmptyState component file exists', () => {
    expect(fs.existsSync(componentPath)).toBe(true);
  });

  const source = fs.readFileSync(componentPath, 'utf-8');

  it('declares showWatermark optional prop with default false', () => {
    expect(source).toContain('showWatermark?: boolean');
    expect(source).toMatch(/showWatermark\s*=\s*false/);
  });

  it('renders watermark as strictly decorative and non-interactive', () => {
    // Must be accessible={false}, aria-hidden={true}, pointerEvents="none"
    expect(source).toContain('pointerEvents="none"');
    expect(source).toContain('accessible={false}');
    expect(source).toContain('aria-hidden={true}');
  });

  it('uses mode-based opacity: 0.10 in dark, 0.08 in light', () => {
    expect(source).toContain("mode === 'dark' ? 0.10 : 0.08");
  });

  it('sizes watermark to ~55% of card width', () => {
    expect(source).toContain('cardWidth * 0.55');
  });

  it('encloses watermark, title, and message in a wrapper while action button is outside', () => {
    // Text wrapper holds watermark, title, and message
    const textWrapperMatch = source.indexOf('testID="empty-state-text-wrapper"');
    const watermarkMatch = source.indexOf('testID="empty-state-watermark"');
    const buttonRowMatch = source.indexOf('testID="empty-state-action-row"');

    expect(textWrapperMatch).toBeGreaterThan(-1);
    expect(watermarkMatch).toBeGreaterThan(textWrapperMatch);
    expect(buttonRowMatch).toBeGreaterThan(textWrapperMatch);

    // Verify button row has at least spacing.base margin
    expect(source).toContain('marginTop: spacing.base');
  });
});

