import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getWebMovieColumns } from '../utils/webLayout';

describe('A VUE Movies Header Option A Contract', () => {
  const screenShellPath = path.resolve(__dirname, '../components/ScreenShell.tsx');
  const moviesHomePath = path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx');
  const screensDir = path.resolve(__dirname, '../screens');

  const screenShellSrc = fs.readFileSync(screenShellPath, 'utf-8');
  const moviesHomeSrc = fs.readFileSync(moviesHomePath, 'utf-8');

  it("ScreenShell.tsx declares titleAlign and headerInset with default 'center'", () => {
    // Declares props in ScreenShellProps
    expect(screenShellSrc).toMatch(/titleAlign\?:\s*['"]center['"]\s*\|\s*['"]left['"]/);
    expect(screenShellSrc).toMatch(/headerInset\?:\s*number/);

    // Default value for titleAlign is 'center'
    expect(screenShellSrc).toMatch(/titleAlign\s*=\s*['"]center['"]/);

    // Default fallback for headerInset is spacing.base
    expect(screenShellSrc).toMatch(/headerInset\s*!==\s*undefined\s*\?\s*headerInset\s*:\s*spacing\.base/);
  });

  it('headerInset on the Movies screen is derived from the same tokens as the grid inset', () => {
    expect(moviesHomeSrc).toContain('titleAlign="left"');

    // Derives cardGridInset from grid tokens (ScreenShell padding + FlatList padding)
    expect(moviesHomeSrc).toMatch(/cardGridInset\s*=\s*spacing\.base\s*\+\s*spacing\.base/);
    expect(moviesHomeSrc).toContain('headerInset={cardGridInset}');

    // FlatList grid uses the same spacing.base token
    expect(moviesHomeSrc).toMatch(/contentContainerStyle=\{\{[\s\S]*?padding:\s*spacing\.base/);
  });

  it('ScreenShell applies headerInset to both sides of the header for left alignment', () => {
    expect(screenShellSrc).toMatch(/paddingLeft:\s*effectiveHeaderInset/);
    expect(screenShellSrc).toMatch(/paddingRight:\s*effectiveHeaderInset/);
  });

  it('the left-aligned title container has marginRight from a spacing token, numberOfLines={1}, ellipsizeMode="tail", and flexShrink: 1', () => {
    // Guaranteed gap via marginRight from spacing token
    expect(screenShellSrc).toMatch(/marginRight:\s*spacing\.base/);

    // Title container has flex: 1 and flexShrink: 1
    expect(screenShellSrc).toMatch(/headerLeftAlignLeft:\s*\{[\s\S]*?flex:\s*1/);
    expect(screenShellSrc).toMatch(/headerLeftAlignLeft:\s*\{[\s\S]*?flexShrink:\s*1/);

    // Title text has numberOfLines={1} and ellipsizeMode="tail"
    expect(screenShellSrc).toMatch(/numberOfLines=\{1\}/);
    expect(screenShellSrc).toMatch(/ellipsizeMode=["']tail["']/);
  });

  it('the pills container has flexShrink: 0', () => {
    expect(screenShellSrc).toMatch(/headerRightAlignLeft:\s*\{[\s\S]*?flexShrink:\s*0/);
    expect(moviesHomeSrc).toMatch(/headerRightContainer:\s*\{[\s\S]*?flexShrink:\s*0/);
  });

  it('no absolute positioning is used in the left-aligned header', () => {
    // Header layout styles in ScreenShell do not use absolute positioning
    const screenShellHeaderStyles = screenShellSrc.match(/headerRow:[\s\S]*?scrollContent:/);
    expect(screenShellHeaderStyles).not.toBeNull();
    expect(screenShellHeaderStyles![0]).not.toContain("position: 'absolute'");
    expect(screenShellHeaderStyles![0]).not.toContain('position: "absolute"');

    // Header layout styles in MoviesHomeScreen do not use absolute positioning
    const moviesHeaderStyles = moviesHomeSrc.match(/headerRightContainer:[\s\S]*?cardWrapper:/);
    expect(moviesHeaderStyles).not.toBeNull();
    expect(moviesHeaderStyles![0]).not.toContain("position: 'absolute'");
    expect(moviesHeaderStyles![0]).not.toContain('position: "absolute"');
  });

  it('no other screen file contains titleAlign', () => {
    const files = fs.readdirSync(screensDir).filter(
      (file) => (file.endsWith('.tsx') || file.endsWith('.ts')) && file !== 'MoviesHomeScreen.tsx'
    );

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const filePath = path.join(screensDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content, `Screen file ${file} should not contain titleAlign`).not.toContain('titleAlign');
    }
  });

  it('ScreenShell title style uses titleLargeReduced for the left variant', () => {
    expect(screenShellSrc).toContain('typography.titleLargeReduced');

    // Left variant uses titleLargeReduced properties for font family, size and weight
    const leftTitleMatch = screenShellSrc.match(
      /titleAlign\s*===\s*['"]left['"]\s*&&\s*title[\s\S]*?typography\.titleLargeReduced[\s\S]*?<\/Text>/
    );
    expect(leftTitleMatch).not.toBeNull();
    const leftTitleSnippet = leftTitleMatch![0];
    expect(leftTitleSnippet).toContain('typography.titleLargeReduced.fontFamily');
    expect(leftTitleSnippet).toContain('typography.titleLargeReduced.fontSize');
    expect(leftTitleSnippet).toContain('typography.titleLargeReduced.fontWeight');
    expect(leftTitleSnippet).toContain('color: colors.on_surface');
    expect(leftTitleSnippet).toContain('accessibilityRole="header"');
    expect(leftTitleSnippet).toContain('numberOfLines={1}');
  });
});

describe('A VUE web movie grid columns', () => {
  it('derives columns from width with a minimum of 2', () => {
    expect(getWebMovieColumns(390)).toBe(2);
    expect(getWebMovieColumns(899)).toBe(3);
    expect(getWebMovieColumns(900)).toBe(3);
    expect(getWebMovieColumns(1440)).toBe(6);
    expect(getWebMovieColumns(2560)).toBe(11);
    expect(getWebMovieColumns(0)).toBe(2);
  });
});
