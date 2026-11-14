import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('A VUE Showtimes Movie Header Contract', () => {
  const showtimesScreenPath = path.resolve(__dirname, '../screens/ShowtimesScreen.tsx');
  const stringsPath = path.resolve(__dirname, '../constants/strings.ts');

  const showtimesSrc = fs.readFileSync(showtimesScreenPath, 'utf-8');
  const stringsSrc = fs.readFileSync(stringsPath, 'utf-8');

  it('declares the rounded movie header container using design tokens', () => {
    // Defines movieHeaderContainer in styles
    expect(showtimesSrc).toMatch(/movieHeaderContainer:\s*\{[\s\S]*?flexDirection:\s*['"]row['"]/);

    // Uses design tokens for container surface color, radius, and spacing
    expect(showtimesSrc).toContain('backgroundColor: colors.surface_container_low');
    expect(showtimesSrc).toContain('borderRadius: radius.md');
    expect(showtimesSrc).toContain('marginHorizontal: spacing.base');
  });

  it("sets the poster Image's accessibilityLabel from strings.ts and enforces fixed 2:3 ratio", () => {
    // Strings constant for poster accessibility label exists
    expect(stringsSrc).toMatch(/posterAccessibilityLabel:\s*\(title:\s*string\)\s*=>/);

    // Poster Image has accessibilityRole="image" and accessibilityLabel from strings constant
    expect(showtimesSrc).toMatch(
      /<Image[\s\S]*?accessibilityRole="image"[\s\S]*?accessibilityLabel=\{STRINGS\.showtimes\.posterAccessibilityLabel\(movieTitle\)\}/
    );

    // Poster has fixed 2:3 aspect ratio and rounded corners
    expect(showtimesSrc).toMatch(/headerPoster:\s*\{[\s\S]*?width:\s*56[\s\S]*?aspectRatio:\s*2\s*\/\s*3/);
    expect(showtimesSrc).toContain('borderRadius: radius.sm');
  });

  it('configures title container with flex: 1, minWidth: 0, numberOfLines={2}, and ellipsizeMode="tail"', () => {
    // Title container has flex: 1 and minWidth: 0
    expect(showtimesSrc).toMatch(/headerTextContainer:\s*\{[\s\S]*?flex:\s*1/);
    expect(showtimesSrc).toMatch(/headerTextContainer:\s*\{[\s\S]*?minWidth:\s*0/);

    // Title text has numberOfLines={2} and ellipsizeMode="tail"
    expect(showtimesSrc).toMatch(/numberOfLines=\{2\}/);
    expect(showtimesSrc).toMatch(/ellipsizeMode=["']tail["']/);
  });

  it('implements the no-poster fallback branch without an image and without breaking layout', () => {
    // Checks conditional rendering based on hasPoster
    expect(showtimesSrc).toContain('hasPoster ?');

    // In the fallback branch, title renders inside headerTextContainer without Image
    const fallbackMatch = showtimesSrc.match(/:\s*\(\s*<View style=\{styles\.headerTextContainer\}>[\s\S]*?<\/View>\s*\)\s*\}/);
    expect(fallbackMatch).not.toBeNull();
    const fallbackSnippet = fallbackMatch![0];
    expect(fallbackSnippet).not.toContain('<Image');
    expect(fallbackSnippet).toContain('{movieTitle}');
  });

  it('contains zero hex colour literals in ShowtimesScreen.tsx', () => {
    // Rule: Colours from tokens only. Never invent a colour.
    const hexLiterals = showtimesSrc.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(hexLiterals).toBeNull();
  });
});
