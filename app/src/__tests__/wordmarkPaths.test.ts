import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

describe('A VUE Wordmark Chevron Paths and Brand Logo', () => {
  const wordmarkSrc = fs.readFileSync(
    path.resolve(__dirname, '../components/Wordmark.tsx'),
    'utf-8'
  );
  const clapperSrc = fs.readFileSync(
    path.resolve(__dirname, '../components/ClapperMark.tsx'),
    'utf-8'
  );
  const welcomeHeroSrc = fs.readFileSync(
    path.resolve(__dirname, '../components/WelcomeHero.tsx'),
    'utf-8'
  );

  // Extract WORDMARK_PATHS from Wordmark.tsx source text without importing React Native
  const pathMatches = [
    ...wordmarkSrc.matchAll(/\{\s*id:\s*['"]([A-Z])['"],\s*d:\s*['"]([^'"]+)['"]\s*\}/g),
  ];
  const wordmarkPaths = pathMatches.map((m) => ({ id: m[1], d: m[2] }));

  // Extract WORDMARK_BOX from Wordmark.tsx source text
  const boxMatch = wordmarkSrc.match(
    /export const WORDMARK_BOX\s*=\s*\{\s*w:\s*([\d.]+),\s*h:\s*([\d.]+),\s*top:\s*([\d.]+),\s*bottom:\s*([\d.]+)\s*\};/
  );
  const wordmarkBox = boxMatch
    ? {
        w: parseFloat(boxMatch[1]),
        h: parseFloat(boxMatch[2]),
        top: parseFloat(boxMatch[3]),
        bottom: parseFloat(boxMatch[4]),
      }
    : null;

  it('WORDMARK_PATHS has ids A, V, U, E and every d starts with M and ends with Z', () => {
    expect(wordmarkPaths).toHaveLength(4);
    const ids = wordmarkPaths.map((p) => p.id);
    expect(ids).toEqual(['A', 'V', 'U', 'E']);

    for (const p of wordmarkPaths) {
      const trimmed = p.d.trim();
      expect(trimmed.startsWith('M')).toBe(true);
      expect(trimmed.endsWith('Z')).toBe(true);
    }

    // Verify bounding box values
    expect(wordmarkBox).not.toBeNull();
    expect(wordmarkBox!.w).toBe(578);
    expect(wordmarkBox!.h).toBe(111);
    expect(wordmarkBox!.top).toBe(1.5);
    expect(wordmarkBox!.bottom).toBe(109);
  });

  it('source text of Wordmark.tsx, ClapperMark.tsx, and WelcomeHero.tsx contains no strokeWidth for the wordmark', () => {
    // Wordmark.tsx and ClapperMark.tsx have no strokeWidth anywhere
    expect(wordmarkSrc).not.toContain('strokeWidth');
    expect(clapperSrc).not.toContain('strokeWidth');

    // WelcomeHero.tsx uses strokeWidth only for character art lines, not for the wordmark
    const wordmarkSectionMatch = welcomeHeroSrc.match(
      /\{\/\* Wordmark inside panel[\s\S]*?\{\/\* Lid raised/
    );
    expect(wordmarkSectionMatch).not.toBeNull();
    const wordmarkSection = wordmarkSectionMatch![0];
    expect(wordmarkSection).not.toContain('strokeWidth');
    expect(wordmarkSection).toContain('fill={nameColor}');

    // Ensure none of the WORDMARK_PATHS in source contain stroke definitions
    const pathsSection = wordmarkSrc.match(/export const WORDMARK_PATHS\s*=\s*\[([\s\S]*?)\];/);
    expect(pathsSection).not.toBeNull();
    expect(pathsSection![1]).not.toContain('stroke');
    expect(pathsSection![1]).not.toContain('strokeWidth');
  });

  it("nameColor comes from colorData.palettes.primary['80']", () => {
    // Palette primary 80 must exist in design tokens and match peach tone
    const primary80 = colorData.palettes.primary['80'];
    expect(primary80).toBe('#FFCEBE');

    expect(clapperSrc).toMatch(/nameColor\s*=\s*colorData\.palettes\.primary\['80'\]/);
    expect(welcomeHeroSrc).toMatch(/nameColor\s*=\s*colorData\.palettes\.primary\['80'\]/);
    expect(wordmarkSrc).toContain("colorData.palettes.primary['80']");
  });
});
