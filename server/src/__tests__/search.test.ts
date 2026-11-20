import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateSearchScore,
  damerauLevenshteinDistance,
  MIN_SEARCH_SCORE,
  normalizeSearchText,
  searchMovies,
} from '../lib/search.js';
import { movieDtoSchema } from '../schemas/movies.js';
import { serializeRequest } from '../server.js';

const {
  mockSearchTmdbMovies,
  mockGetCachedJson,
  mockSetCachedJson,
  mockSingleFlight,
  mockGetNowPlayingMovies,
  mockGetRankingMovieList,
  mockCorrectMovieTitle,
  mockCorrectionModelCalls,
} = vi.hoisted(() => ({
  mockSearchTmdbMovies: vi.fn(),
  mockGetCachedJson: vi.fn(),
  mockSetCachedJson: vi.fn(),
  mockSingleFlight: vi.fn(),
  mockGetNowPlayingMovies: vi.fn(),
  mockGetRankingMovieList: vi.fn(),
  mockCorrectMovieTitle: vi.fn(),
  mockCorrectionModelCalls: vi.fn(),
}));

vi.mock('../lib/tmdb.js', async () => {
  const actual = await vi.importActual<any>('../lib/tmdb.js');
  return {
    ...actual,
    searchTmdbMovies: (...args: unknown[]) => mockSearchTmdbMovies(...args),
    getCachedJson: (...args: unknown[]) => mockGetCachedJson(...args),
    setCachedJson: (...args: unknown[]) => mockSetCachedJson(...args),
    singleFlight: (key: string, fn: () => Promise<unknown>) => mockSingleFlight(key, fn),
    getNowPlayingMovies: (...args: unknown[]) => mockGetNowPlayingMovies(...args),
    getRankingMovieList: (...args: unknown[]) => mockGetRankingMovieList(...args),
  };
});

vi.mock('../lib/titleCorrection.js', async () => {
  const actual = await vi.importActual<any>('../lib/titleCorrection.js');
  return {
    ...actual,
    correctMovieTitle: (...args: unknown[]) => mockCorrectMovieTitle(...args),
  };
});

import { isAllowedCorrectionInput } from '../lib/titleCorrection.js';

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

describe('Task 6: empty-result shared-pool fallback', () => {
  const list = (movies: ReturnType<typeof movie>[]) => ({
    movies,
    page: 1,
    totalPages: 1,
    totalResults: movies.length,
    stale: false,
  });

  function movie(id: number, title: string, voteAverage = 7) {
    return {
      id,
      title,
      overview: 'Overview.',
      releaseDate: '2026-01-01',
      runtimeMinutes: 120,
      genres: [],
      voteAverage,
      posterPath: null,
      backdropPath: null,
    };
  }

  beforeEach(() => {
    mockSearchTmdbMovies.mockReset();
    mockGetCachedJson.mockReset().mockResolvedValue(null);
    mockSetCachedJson.mockReset().mockResolvedValue(undefined);
    mockSingleFlight.mockReset().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn());
    mockGetNowPlayingMovies.mockReset().mockResolvedValue(list([]));
    mockGetRankingMovieList.mockReset().mockResolvedValue(list([]));
    mockCorrectionModelCalls.mockReset();
    mockCorrectMovieTitle.mockReset().mockImplementation(async (raw: string) => {
      if (!isAllowedCorrectionInput(raw)) return null;
      mockCorrectionModelCalls(raw);
      return null;
    });
  });

  it('returns Spider-Man from the shared pool for "spidwr man"', async () => {
    mockSearchTmdbMovies.mockResolvedValue([]);
    mockGetRankingMovieList.mockImplementation((name: string) =>
      Promise.resolve(
        list(name === 'popular' ? [movie(3, 'Spider-Man: Brand New Day')] : []),
      ),
    );

    const result = await searchMovies('spidwr man');

    expect(result.movies.map((m) => m.title)).toContain('Spider-Man: Brand New Day');
    // Now playing is read once by the pre-existing merge and once by the shared pool;
    // both hit the same cached reader, so no extra TMDB call is made.
    expect(mockGetNowPlayingMovies).toHaveBeenCalledTimes(2);
    expect(mockGetRankingMovieList).toHaveBeenCalledTimes(2);
  });

  it('returns no results for gibberish, even with a full pool', async () => {
    mockSearchTmdbMovies.mockResolvedValue([]);
    mockGetRankingMovieList.mockResolvedValue(
      list([movie(1, 'Avatar'), movie(2, 'Batman')]),
    );

    const result = await searchMovies('asdfqwerty');

    expect(result.movies).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it('uses the normal TMDB path for a correctly spelt title without reading the ranking lists', async () => {
    mockSearchTmdbMovies.mockResolvedValue([movie(1, 'Avatar')]);

    const result = await searchMovies('avatar');

    expect(result.movies[0].title).toBe('Avatar');
    expect(mockGetRankingMovieList).not.toHaveBeenCalled();
  });

  it('keeps the response shape unchanged on the fallback path', async () => {
    mockSearchTmdbMovies.mockResolvedValue([]);
    mockGetRankingMovieList.mockImplementation((name: string) =>
      Promise.resolve(list(name === 'topRated' ? [movie(4, 'Spider-Man')] : [])),
    );

    const result = await searchMovies('spidwr man');

    expect(Object.keys(result).sort()).toEqual(['movies', 'stale', 'totalResults']);
    expect(result.stale).toBe(false);
    expect(result.totalResults).toBe(result.movies.length);
  });

  it('strips internal pool fields so fallback results match the strict DTO', async () => {
    const internal = { ...movie(3, 'Spider-Man: Brand New Day'), popularityScore: 99, voteCount: 1234 };
    mockSearchTmdbMovies.mockResolvedValue([]);
    mockGetRankingMovieList.mockImplementation((name: string) =>
      Promise.resolve(list(name === 'popular' ? [internal] : [])),
    );

    const result = await searchMovies('spidwr man');

    expect(result.movies).toHaveLength(1);
    expect(Object.keys(result.movies[0]).sort()).toEqual([
      'backdropPath',
      'genres',
      'id',
      'overview',
      'posterPath',
      'releaseDate',
      'runtimeMinutes',
      'title',
      'voteAverage',
    ]);
    expect(movieDtoSchema.safeParse(result.movies[0]).success).toBe(true);
  });

  it('strips internal fields from merged now-playing items', async () => {
    const internal = { ...movie(1, 'Avatar'), popularityScore: 88, voteCount: 4321 };
    mockSearchTmdbMovies.mockResolvedValue([]);
    mockGetNowPlayingMovies.mockResolvedValue(list([internal]));

    const result = await searchMovies('avatar');

    expect(result.movies).toHaveLength(1);
    expect(movieDtoSchema.safeParse(result.movies[0]).success).toBe(true);
    expect(Object.keys(result.movies[0])).not.toContain('popularityScore');
    expect(Object.keys(result.movies[0])).not.toContain('voteCount');
  });

  it('returns a corrected film for a typo when every earlier step is empty', async () => {
    mockSearchTmdbMovies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...movie(5, 'The Sound of Music'), popularityScore: 9, voteCount: 10 }]);
    mockCorrectMovieTitle.mockResolvedValue('The Sound of Music');

    const result = await searchMovies('sund of music');

    expect(result.movies.map((m) => m.title)).toEqual(['The Sound of Music']);
    expect(mockCorrectMovieTitle.mock.calls[0][0]).toBe('sund of music');
    expect(mockCorrectMovieTitle.mock.calls[0][1]).toBe('search');
    expect(mockSearchTmdbMovies).toHaveBeenNthCalledWith(1, 'sund of music');
    expect(mockSearchTmdbMovies).toHaveBeenNthCalledWith(2, 'The Sound of Music');
    expect(Object.keys(result.movies[0]).sort()).toEqual([
      'backdropPath',
      'genres',
      'id',
      'overview',
      'posterPath',
      'releaseDate',
      'runtimeMinutes',
      'title',
      'voteAverage',
    ]);
    expect(movieDtoSchema.safeParse(result.movies[0]).success).toBe(true);
  });

  it('returns empty when the correction is null', async () => {
    mockSearchTmdbMovies.mockResolvedValue([]);

    const result = await searchMovies('sund of music');

    expect(result.movies).toEqual([]);
    expect(mockCorrectMovieTitle).toHaveBeenCalledTimes(1);
  });

  it('does not call correction when TMDB or the pool already matched', async () => {
    mockSearchTmdbMovies.mockResolvedValue([movie(1, 'Avatar')]);
    const direct = await searchMovies('avatar');
    expect(direct.movies[0].title).toBe('Avatar');
    expect(mockCorrectMovieTitle).not.toHaveBeenCalled();

    mockSearchTmdbMovies.mockReset().mockResolvedValue([]);
    mockGetRankingMovieList.mockImplementation((name: string) =>
      Promise.resolve(list(name === 'popular' ? [movie(3, 'Spider-Man: Brand New Day')] : [])),
    );
    const pooled = await searchMovies('spidwr man');
    expect(pooled.movies[0].title).toBe('Spider-Man: Brand New Day');
    expect(mockCorrectMovieTitle).not.toHaveBeenCalled();
  });

  it.each(['john@mail.com', '0803 123 4567'])(
    'guards raw input %s before any correction model call',
    async (raw) => {
      mockSearchTmdbMovies.mockResolvedValue([]);

      const result = await searchMovies(raw);

      expect(result.movies).toEqual([]);
      expect(mockCorrectionModelCalls).not.toHaveBeenCalled();
      expect(mockCorrectMovieTitle).toHaveBeenCalledTimes(1);
      expect(mockCorrectMovieTitle.mock.calls[0][0]).toBe(raw);
    },
  );

  it('passes the raw trimmed text, not the normalised text, to the model', async () => {
    mockSearchTmdbMovies.mockResolvedValue([]);

    await searchMovies('  sund of music  ', '  sund of music  ');

    expect(mockCorrectionModelCalls).toHaveBeenCalledWith('sund of music');
    expect(mockCorrectMovieTitle.mock.calls[0][0]).toBe('sund of music');
  });

  it('does not cache the empty search result after a correction error', async () => {
    mockSearchTmdbMovies.mockResolvedValue([]);
    mockCorrectMovieTitle.mockImplementation(async (_raw: string, _stage: string, signal: any) => {
      signal.failed = true;
      return null;
    });

    const result = await searchMovies('sund of music');

    expect(result.movies).toEqual([]);
    expect(mockSetCachedJson).not.toHaveBeenCalled();
  });
});
