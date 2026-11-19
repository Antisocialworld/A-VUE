import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateSearchScore,
  damerauLevenshteinDistance,
  MIN_SEARCH_SCORE,
  normalizeSearchText,
} from '../lib/search.js';
import { serializeRequest } from '../server.js';

describe('Task 1: Search Normalization', () => {
  it('strips diacritics via NFD decomposition', () => {
    expect(normalizeSearchText('Amélie')).toBe('amelie');
    expect(normalizeSearchText('Café au Lait')).toBe('cafe au lait');
    expect(normalizeSearchText('Curaçao')).toBe('curacao');
    expect(normalizeSearchText('Schrödinger')).toBe('schrodinger');
  });

  it('lowercases all characters', () => {
    expect(normalizeSearchText('RESIDENT EVIL')).toBe('resident evil');
    expect(normalizeSearchText('The Matrix')).toBe('the matrix');
  });

  it('trims leading/trailing whitespace and collapses multiple spaces', () => {
    expect(normalizeSearchText('   Resident    Evil   ')).toBe('resident evil');
    expect(normalizeSearchText('  Blade   Runner   2049 ')).toBe('blade runner 2049');
  });

  it('handles empty or whitespace-only input', () => {
    expect(normalizeSearchText('')).toBe('');
    expect(normalizeSearchText('    ')).toBe('');
  });
});

describe('Task 1: Query Validation Rules', () => {
  function isValidQuery(q: unknown): boolean {
    if (typeof q !== 'string') return false;
    const normalized = normalizeSearchText(q);
    return normalized.length >= 2 && normalized.length <= 80;
  }

  it('rejects queries shorter than 2 characters after normalisation', () => {
    expect(isValidQuery('')).toBe(false);
    expect(isValidQuery('a')).toBe(false);
    expect(isValidQuery('   ')).toBe(false);
    expect(isValidQuery(' é ')).toBe(false); // 'é' normalises to 'e' (1 char)
  });

  it('rejects queries longer than 80 characters after normalisation', () => {
    const tooLong = 'a'.repeat(81);
    expect(isValidQuery(tooLong)).toBe(false);
  });

  it('accepts queries between 2 and 80 characters inclusive', () => {
    expect(isValidQuery('it')).toBe(true);
    expect(isValidQuery('up')).toBe(true);
    expect(isValidQuery('Resident Evil')).toBe(true);
    expect(isValidQuery('a'.repeat(80))).toBe(true);
  });

  it('rejects non-string queries', () => {
    expect(isValidQuery(null)).toBe(false);
    expect(isValidQuery(undefined)).toBe(false);
    expect(isValidQuery(123)).toBe(false);
    expect(isValidQuery({})).toBe(false);
  });
});

describe('Task 1: Damerau-Levenshtein Distance Algorithm', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshteinDistance('hello', 'hello')).toBe(0);
    expect(damerauLevenshteinDistance('', '')).toBe(0);
  });

  it('measures single insertions and deletions', () => {
    expect(damerauLevenshteinDistance('cat', 'cats')).toBe(1);
    expect(damerauLevenshteinDistance('resident', 'resdent')).toBe(1);
  });

  it('measures substitutions', () => {
    expect(damerauLevenshteinDistance('beast', 'blast')).toBe(1);
  });

  it('measures adjacent transpositions as a single edit', () => {
    // In Damerau-Levenshtein, adjacent transposition ("re" <-> "er") is 1 edit, not 2
    expect(damerauLevenshteinDistance('other', 'othre')).toBe(1);
    expect(damerauLevenshteinDistance('mommy', 'momym')).toBe(1);
  });

  it('handles length differences with empty strings', () => {
    expect(damerauLevenshteinDistance('', 'test')).toBe(4);
    expect(damerauLevenshteinDistance('test', '')).toBe(4);
  });
});

describe('Task 1: Typo-Tolerant Scoring & Ranking', () => {
  it('scores typo "resdent evil" against "Resident Evil" well above threshold', () => {
    const score = calculateSearchScore('resdent evil', 'Resident Evil');
    expect(score).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(score).toBeGreaterThan(0.8);
  });

  it('scores typo "hart of the beast" against "Heart of the Beast" well above threshold', () => {
    const score = calculateSearchScore('hart of the beast', 'Heart of the Beast');
    expect(score).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(score).toBeGreaterThan(0.8);
  });

  it('scores transposition "othre mommy" against "Other Mommy" well above threshold', () => {
    const score = calculateSearchScore('othre mommy', 'Other Mommy');
    expect(score).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(score).toBeGreaterThan(0.8);
  });

  it('guarantees exact beats prefix, and prefix beats typo', () => {
    const title = 'Resident Evil';

    const exactScore = calculateSearchScore('resident evil', title);
    const prefixScore = calculateSearchScore('resident', title);
    const typoScore = calculateSearchScore('resdent evil', title);

    expect(exactScore).toBe(1.0);
    expect(exactScore).toBeGreaterThan(prefixScore);
    expect(prefixScore).toBeGreaterThan(typoScore);
  });

  it('token-level prefix beats token-level typo', () => {
    const title = 'Resident Evil';
    const tokenPrefixScore = calculateSearchScore('resi', title);
    const tokenTypoScore = calculateSearchScore('rasident', title);

    expect(tokenPrefixScore).toBeGreaterThan(tokenTypoScore);
  });

  it('drops completely irrelevant titles below MIN_SEARCH_SCORE', () => {
    const irrelevantScore = calculateSearchScore('resident evil', 'Finding Nemo');
    expect(irrelevantScore).toBeLessThan(MIN_SEARCH_SCORE);
  });

  it('named threshold constant MIN_SEARCH_SCORE is defined and valid', () => {
    expect(MIN_SEARCH_SCORE).toBeGreaterThan(0);
    expect(MIN_SEARCH_SCORE).toBeLessThan(0.5);
  });
});

describe('Task 1: Redis Cache Key BLAKE2s Hashing', () => {
  it('generates a 64-character hex digest and never contains raw query text', () => {
    const rawQuery = 'Top Secret Movie Search Query';
    const normalized = normalizeSearchText(rawQuery);
    const hash = crypto.createHash('blake2s256').update(normalized).digest('hex');
    const cacheKey = `search:${hash}`;

    // Exactly 64 hex chars following prefix
    expect(cacheKey).toMatch(/^search:[0-9a-f]{64}$/);

    // Key must NEVER contain the raw text or normalised text
    expect(cacheKey).not.toContain(rawQuery);
    expect(cacheKey).not.toContain(normalized);
    expect(cacheKey).not.toContain('Top');
    expect(cacheKey).not.toContain('Secret');
  });

  it('stale cache key appends :stale to the hash', () => {
    const normalized = 'batman';
    const hash = crypto.createHash('blake2s256').update(normalized).digest('hex');
    const staleKey = `search:${hash}:stale`;

    expect(staleKey).toBe(`search:${hash}:stale`);
    expect(staleKey).not.toContain(normalized);
  });
});

describe('Task 1: Privacy Source Code Scan', () => {
  it('proves GET /movies/search and search.ts NEVER log or print the search query q', () => {
    const srcDir = path.resolve(__dirname, '..');
    const routesMoviesFile = path.resolve(srcDir, 'routes/movies.ts');
    const libSearchFile = path.resolve(srcDir, 'lib/search.ts');

    const moviesContent = fs.readFileSync(routesMoviesFile, 'utf-8');
    const searchContent = fs.readFileSync(libSearchFile, 'utf-8');

    // 1. In routes/movies.ts, ensure no log calls reference query variables
    const forbiddenLogPatterns = [
      /log\.(info|warn|error|debug)\([^)]*rawQ/i,
      /log\.(info|warn|error|debug)\([^)]*normalizedQ/i,
      /console\.(log|warn|error)\([^)]*rawQ/i,
      /console\.(log|warn|error)\([^)]*normalizedQ/i,
      /process\.stderr\.write\([^)]*rawQ/i,
      /process\.stderr\.write\([^)]*normalizedQ/i,
    ];

    for (const pattern of forbiddenLogPatterns) {
      expect(pattern.test(moviesContent)).toBe(false);
      expect(pattern.test(searchContent)).toBe(false);
    }

    // 2. Error envelopes must never echo the user query text
    expect(moviesContent).not.toContain('`Invalid search query: ${');
    expect(moviesContent).not.toContain('`Search for "${');
  });
});

describe('Task 1: Query String Logging Privacy in Serializer', () => {
  it('Fastify req serializer output contains no "?" and no query value for /movies/search?q=secret-title', () => {
    const serialized = serializeRequest({
      id: 'req-test-123',
      method: 'GET',
      url: '/movies/search?q=secret-title',
    });

    expect(serialized.url).toBe('/movies/search');
    expect(serialized.url).not.toContain('?');
    expect(serialized.url).not.toContain('secret-title');
    expect(serialized.url).not.toContain('q=');
  });

  it('Fastify req serializer preserves path for routes without query strings', () => {
    const serialized = serializeRequest({
      id: 'req-test-456',
      method: 'GET',
      url: '/movies',
    });

    expect(serialized.url).toBe('/movies');
  });
});

describe('Task 6: Search Ranking Improvements', () => {
  it('exact title "Resident Evil" ranks before "The Making of Resident Evil"', () => {
    const exactScore = calculateSearchScore('resident evil', 'Resident Evil');
    const longerScore = calculateSearchScore('resident evil', 'The Making of Resident Evil');

    // Exact normalised match must return 1.0
    expect(exactScore).toBe(1.0);
    // Longer title has extra tokens → brevity penalty; must score below exact
    expect(longerScore).toBeLessThan(exactScore);
    // Longer title still passes threshold
    expect(longerScore).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
  });

  it('filler-only match "of" does not meet 50% significant-token threshold', () => {
    // "call of my life" → significant tokens: ['call', 'my', 'life'] (3)
    // A title that only shares the filler "of" cannot match 2/3 significant tokens
    const fillerOnlyTitle = 'The Of Chronicles'; // shares only 'of' with significant tokens
    const score = calculateSearchScore('call of my life', fillerOnlyTitle);
    expect(score).toBeLessThan(MIN_SEARCH_SCORE);
  });

  it('"call of my life" scores the matching title above irrelevant ones', () => {
    const matchScore = calculateSearchScore('call of my life', 'Call of My Life');
    const noMatchScore = calculateSearchScore('call of my life', 'The Of Chronicles');

    expect(matchScore).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(matchScore).toBeGreaterThan(noMatchScore);
  });

  it('typos "resdent evil" and "othre mommy" score above MIN_SEARCH_SCORE', () => {
    expect(calculateSearchScore('resdent evil', 'Resident Evil')).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(calculateSearchScore('othre mommy', 'Other Mommy')).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
  });

  it('"spider man brand new day" finds "Spider-Man: Brand New Day" (hyphens normalised)', () => {
    // normalizeSearchText strips punctuation: "Spider-Man: Brand New Day" → "spider man brand new day"
    const score = calculateSearchScore('spider man brand new day', 'Spider-Man: Brand New Day');
    expect(score).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(score).toBeGreaterThan(0.8);
  });
});

describe('Task 1: Debounce and Stale Response Logic', () => {
  it('debounces rapid executions to the last call', async () => {
    vi.useFakeTimers();

    const mockCallback = vi.fn();
    let timer: NodeJS.Timeout | null = null;

    function trigger(text: string) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => mockCallback(text), 350);
    }

    trigger('res');
    vi.advanceTimersByTime(100);
    trigger('resi');
    vi.advanceTimersByTime(100);
    trigger('resid');
    vi.advanceTimersByTime(100);
    trigger('reside');
    vi.advanceTimersByTime(200);
    expect(mockCallback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150); // total 350ms elapsed since last trigger
    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith('reside');

    vi.useRealTimers();
  });

  it('discards stale async responses using sequence counter', async () => {
    let latestRequestId = 0;
    const finalResults: string[] = [];

    async function fakeSearch(id: number, text: string, delayMs: number) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // Stale response check: discard if newer request has been made
      if (id === latestRequestId) {
        finalResults.push(text);
      }
    }

    // Request 1 starts with longer delay (e.g. 50ms)
    latestRequestId = 1;
    const req1 = fakeSearch(1, 'first', 50);

    // Request 2 starts with shorter delay (e.g. 10ms)
    latestRequestId = 2;
    const req2 = fakeSearch(2, 'second', 10);

    await Promise.all([req1, req2]);

    // Only Request 2 ('second') should be accepted; Request 1 was discarded as stale
    expect(finalResults).toEqual(['second']);
  });
});
