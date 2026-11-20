import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mockCorrectMovieTitle = vi.hoisted(() => vi.fn());

vi.mock('../lib/titleCorrection.js', () => ({
  correctMovieTitle: (...args: unknown[]) => mockCorrectMovieTitle(...args),
}));

import {
  MOVIE_LOOKUP_STAGES,
  MOVIE_LOOKUP_STOP_TITLES,
  MOVIE_YEAR_HINT_TEXT,
  RELAXED_MATCH_MIN_SCORE,
  WEAK_MATCH_MIN_SCORE,
  buildLookupQuery,
  detectMovieIntent,
  extractLookupHints,
  extractMovieTitle,
  findCachedMovie,
  findCorrectedMovie,
  findPooledMovie,
  findRelaxedMovie,
  isAcceptableRelaxedMatch,
  isSearchableMovieTitle,
  rankCandidates,
  relaxedSearchQuery,
  toCandidate,
  toMovieSummary,
} from '../lib/assistant/movieLookup.js';
import { calculateSearchScore } from '../lib/search.js';
import { getNowPlayingMovies, searchTmdbMovies } from '../lib/tmdb.js';
import type { MovieDto, MoviesListResponse } from '../schemas/movies.js';

// Mock at the layer above tmdb.ts: the adapter hands the lookup a clean MovieDto list.
// No raw upstream field names, network stub or hand-made cache payload belongs here.
vi.mock('../env.js', () => ({
  env: { SEARCH_CACHE_TTL_SECONDS: 600 },
}));
vi.mock('../lib/tmdb.js', () => ({
  getNowPlayingMovies: vi.fn(),
  getRankingMovieList: vi.fn(),
  getCachedJson: vi.fn().mockResolvedValue(null),
  searchTmdbMovies: vi.fn().mockResolvedValue([]),
  setCachedJson: vi.fn().mockResolvedValue(undefined),
  singleFlight: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));

const NO_HINTS = { year: null, wantsNew: false } as const;

describe('movieLookup intent and title extraction', () => {
  it.each([
    ['Can I see Spider-Man: Brand New Day poster?', 'Spider-Man: Brand New Day'],
    ['show me the poster of Dune', 'Dune'],
    ['what does Lord of the Rings look like', 'Lord of the Rings'],
    ['tell me about Inception', 'Inception'],
  ])('extracts the title from "%s"', (message, title) => {
    expect(detectMovieIntent(message)).not.toBe('none');
    expect(extractMovieTitle(message)).toBe(title);
  });

  it('does not trigger on procedural or greeting messages', () => {
    for (const message of ['How do I book tickets?', 'Hi', 'Thank you']) {
      expect(detectMovieIntent(message)).toBe('none');
      expect(extractMovieTitle(message)).toBeNull();
    }
  });

  it('does not treat bare "see" as a trigger', () => {
    expect(detectMovieIntent('see')).toBe('none');
  });

  it('rejects titles outside 2-100 characters', () => {
    expect(extractMovieTitle('show me A poster')).toBeNull();
    expect(extractMovieTitle(`show me ${'x'.repeat(101)} poster`)).toBeNull();
  });

  it('shapes the top result with file-name poster and bounded overview', () => {
    const movie: MovieDto = {
      id: 123,
      title: 'Example',
      overview: `${'word '.repeat(80)}tail`,
      releaseDate: '2026-11-19',
      runtimeMinutes: 120,
      genres: [],
      voteAverage: 7,
      posterPath: '/abc123.jpg',
      backdropPath: null,
    };

    const summary = toMovieSummary(movie);
    expect(summary).toMatchObject({
      tmdbId: 123,
      title: 'Example',
      year: '2026',
      posterPath: 'abc123.jpg',
    });
    expect(summary.overview.length).toBeLessThanOrEqual(300);
    expect(summary.overview.endsWith(' ')).toBe(false);
  });

  it('returns null for a message with no movie intent', () => {
    expect(extractMovieTitle('How do I book tickets?')).toBeNull();
    expect(extractMovieTitle('Hi')).toBeNull();
  });

  it('uses one weak-intent score constant and blocks generic titles', () => {
    expect(WEAK_MATCH_MIN_SCORE).toBe(0.85);
    for (const title of MOVIE_LOOKUP_STOP_TITLES) {
      expect(isSearchableMovieTitle(title)).toBe(false);
    }
    expect(isSearchableMovieTitle('Dune')).toBe(true);
  });
});

describe('movieLookup one-retry typo path (mocked search results, no network)', () => {
  function makeMovie(title: string, id = 550): MovieDto {
    return {
      id,
      title,
      overview: 'Overview.',
      releaseDate: '2026-01-01',
      runtimeMinutes: 120,
      genres: [],
      voteAverage: 7,
      posterPath: null,
      backdropPath: null,
    };
  }

  it('relaxes to the first two title words and never more than one retry', async () => {
    expect(relaxedSearchQuery('spidwr man image or')).toBe('spidwr man');
    const search = vi.fn().mockResolvedValue({ movies: [makeMovie('Spider-Man: Brand New Day')] });
    const match = await findRelaxedMovie('spidwr man image or', 'strong', search);
    expect(match?.title).toBe('Spider-Man: Brand New Day');
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('spidwr man');
  });

  it.each([
    ['spidwr man', 'Spider-Man: Brand New Day'],
    ['spiderman', 'Spider-Man'],
    ['spider man brand new day', 'Spider-Man: Brand New Day'],
    ['avatr', 'Avatar'],
    ['batmn', 'Batman'],
  ])('accepts "%s" against "%s" with the evidence-based floor', async (title, candidate) => {
    expect(calculateSearchScore(title, candidate)).toBeGreaterThanOrEqual(RELAXED_MATCH_MIN_SCORE);
    const search = vi.fn().mockResolvedValue({ movies: [makeMovie(candidate)] });
    expect((await findRelaxedMovie(title, 'strong', search))?.title).toBe(candidate);
  });

  it.each(['asdfqwerty', 'cinema'])('rejects unrelated query "%s"', async (title) => {
    const search = vi.fn().mockResolvedValue({
      movies: [
        makeMovie('Spider-Man: Brand New Day', 1),
        makeMovie('Avatar', 2),
        makeMovie('Batman', 3),
      ],
    });
    expect(calculateSearchScore(title, 'Spider-Man: Brand New Day')).toBe(0);
    expect(await findRelaxedMovie(title, 'strong', search)).toBeNull();
  });

  it('keeps the stricter weak-intent threshold on the retry', () => {
    const title = 'spidwr man image or';
    const candidate = 'Spider-Man: Brand New Day';
    expect(isAcceptableRelaxedMatch(title, candidate, 'strong')).toBe(true);
    expect(isAcceptableRelaxedMatch(title, candidate, 'weak')).toBe(false);
    expect(WEAK_MATCH_MIN_SCORE).toBeGreaterThan(RELAXED_MATCH_MIN_SCORE);
  });

  it('treats a failed retry as no match', async () => {
    const search = vi.fn().mockRejectedValue(new Error('SEARCH_UNAVAILABLE'));
    expect(await findRelaxedMovie('spidwr man', 'strong', search)).toBeNull();
  });

  it('records the evidence scores behind the 0.5 floor', () => {
    expect(calculateSearchScore('spidwr man', 'Spider-Man: Brand New Day')).toBeCloseTo(0.689, 3);
    expect(calculateSearchScore('spidwr man', 'Spider-Man')).toBeCloseTo(0.854, 3);
    expect(calculateSearchScore('spiderman', 'Spider-Man')).toBeCloseTo(0.708, 3);
    expect(calculateSearchScore('spider man brand new day', 'Spider-Man: Brand New Day')).toBe(1);
    expect(calculateSearchScore('avatr', 'Avatar')).toBeCloseTo(0.708, 3);
    expect(calculateSearchScore('batmn', 'Batman')).toBeCloseTo(0.708, 3);
    expect(calculateSearchScore('asdfqwerty', 'Avatar')).toBe(0);
    expect(calculateSearchScore('cinema', 'Avatar')).toBe(0);
    expect(calculateSearchScore('spidwr man image or', 'Spider-Man: Brand New Day')).toBeCloseTo(0.514, 3);
  });
});

describe('movieLookup now-playing fallback (mocked adapter, DTO list, no network)', () => {
  function makeListMovie(title: string, id: number): MovieDto {
    return {
      id,
      title,
      overview: 'Overview.',
      releaseDate: '2026-01-01',
      runtimeMinutes: 120,
      genres: [],
      voteAverage: 7,
      posterPath: null,
      backdropPath: null,
    };
  }

  // The adapter's output shape, not the raw upstream response.
  const nowPlayingList: MoviesListResponse = {
    movies: [
      makeListMovie('Spider-Man: Brand New Day', 1),
      makeListMovie('Avatar', 2),
      makeListMovie('Avatar: The Way of Water', 3),
      makeListMovie('The Batman', 4),
      makeListMovie('Batman', 5),
      makeListMovie('Dune: Part Two', 6),
      makeListMovie('Inside Out 2', 7),
    ],
    page: 1,
    totalPages: 1,
    totalResults: 7,
    stale: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNowPlayingMovies).mockResolvedValue(nowPlayingList);
  });

  it('matches "spidwr man" through the shared now-playing function, called once', async () => {
    const reader = vi.mocked(getNowPlayingMovies);
    expect((await findCachedMovie('spidwr man', 'strong', reader))?.title).toBe(
      'Spider-Man: Brand New Day',
    );
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it.each(['asdfqwerty', 'cinema'])('rejects unrelated query "%s"', async (title) => {
    const reader = vi.mocked(getNowPlayingMovies);
    expect(await findCachedMovie(title, 'strong', reader)).toBeNull();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('silently returns not-found when the list function throws', async () => {
    const reader = vi.fn().mockRejectedValue(new Error('LIST_UNAVAILABLE'));
    expect(await findCachedMovie('spidwr man', 'strong', reader)).toBeNull();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('silently returns not-found for an empty list', async () => {
    const empty: MoviesListResponse = {
      movies: [],
      page: 1,
      totalPages: 1,
      totalResults: 0,
      stale: false,
    };
    expect(await findCachedMovie('spidwr man', 'strong', async () => empty)).toBeNull();
  });

  it('keeps the fallback strong-intent only', async () => {
    const reader = vi.mocked(getNowPlayingMovies);
    expect(await findCachedMovie('spidwr man', 'weak', reader)).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it('uses the shared now-playing function, not a raw cache key, after the relaxed retry', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../lib/assistant/movieLookup.ts'),
      'utf-8',
    );
    const body = source.slice(source.indexOf('export async function findCachedMovie'));
    expect(body).toContain('readList: NowPlayingListReader = getNowPlayingMovies');
    expect(body).toContain('calculateSearchScore(title, movie.title)');
    expect(body).not.toContain('getCachedJson');
    expect(body).not.toContain('NOW_PLAYING_CACHE_KEY');
    expect(body).not.toContain('searchMovies(');
    expect(body).not.toContain('fetch(');

    const routeSrc = fs.readFileSync(path.resolve(__dirname, '../routes/assistant.ts'), 'utf-8');
    expect(routeSrc.indexOf('findRelaxedMovie(')).toBeGreaterThanOrEqual(0);
    expect(routeSrc.indexOf('match = await findCachedMovie(query, intent);')).toBeGreaterThan(
      routeSrc.indexOf('findRelaxedMovie('),
    );
    expect(routeSrc).toContain('if (!match) {');
  });

  it('records best now-playing scores behind the 0.5 floor', () => {
    expect(calculateSearchScore('spidwr man', 'Spider-Man: Brand New Day')).toBeGreaterThanOrEqual(
      RELAXED_MATCH_MIN_SCORE,
    );
    expect(calculateSearchScore('spidwr man', 'Spider-Man: Brand New Day')).toBeCloseTo(0.689, 3);
    expect(calculateSearchScore('spiderman', 'Spider-Man: Brand New Day')).toBeCloseTo(0.429, 3);
    expect(calculateSearchScore('avatr', 'Avatar')).toBeCloseTo(0.708, 3);
    expect(calculateSearchScore('batmn', 'Batman')).toBeCloseTo(0.708, 3);
  });
});

function plainDto(title: string, id: number): MovieDto {
  return {
    id,
    title,
    overview: 'Overview.',
    releaseDate: '2026-01-01',
    runtimeMinutes: 120,
    genres: [],
    voteAverage: 7,
    posterPath: null,
    backdropPath: null,
  };
}

function candidate(
  title: string,
  opts: {
    id?: number;
    releaseDate?: string;
    popularityScore?: number;
    voteCount?: number;
  } = {},
): ReturnType<typeof toCandidate> {
  return {
    id: opts.id ?? 1,
    title,
    overview: 'Overview.',
    releaseDate: opts.releaseDate ?? '2026-01-01',
    runtimeMinutes: 120,
    genres: [],
    voteAverage: 7,
    posterPath: null,
    backdropPath: null,
    popularityScore: opts.popularityScore ?? 0,
    voteCount: opts.voteCount ?? 0,
  };
}

describe('movieLookup candidate pool (Task 2)', () => {
  it('matches "spidwr man" from injected lists with one call per list', async () => {
    const popular = vi.fn().mockResolvedValue({ movies: [candidate('Avatar', { id: 2 })] });
    const nowPlaying = vi
      .fn()
      .mockResolvedValue({ movies: [candidate('Spider-Man: Brand New Day', { id: 3 })] });
    const topRated = vi.fn().mockResolvedValue({ movies: [candidate('Dune: Part Two', { id: 4 })] });

    const pick = await findPooledMovie('spidwr man', 'strong', NO_HINTS, [
      popular,
      nowPlaying,
      topRated,
    ]);

    expect(pick?.movie.title).toBe('Spider-Man: Brand New Day');
    for (const reader of [popular, nowPlaying, topRated]) {
      expect(reader).toHaveBeenCalledTimes(1);
    }
  });

  it('never builds a pool for weak intent', async () => {
    const reader = vi.fn().mockResolvedValue({ movies: [candidate('Spider-Man')] });
    expect(await findPooledMovie('spidwr man', 'weak', NO_HINTS, [reader])).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(['asdfqwerty', 'cinema'])('keeps non-movie string "%s" as no match', async (title) => {
    const reader = vi.fn().mockResolvedValue({
      movies: [candidate('Avatar', { id: 2 }), candidate('Batman', { id: 3 })],
    });
    expect(await findPooledMovie(title, 'strong', NO_HINTS, [reader])).toBeNull();
  });

  it('skips a failed list and still scores the others', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('LIST_UNAVAILABLE'));
    const good = vi.fn().mockResolvedValue({ movies: [candidate('Spider-Man', { id: 3 })] });
    expect((await findPooledMovie('spidwr man', 'strong', NO_HINTS, [failed, good]))?.movie.id).toBe(
      3,
    );
  });

  it('keeps internal signals off plain DTOs', () => {
    const enriched = toCandidate(plainDto('Avatar', 2));
    expect(enriched.popularityScore).toBe(0);
    expect(enriched.voteCount).toBe(0);
  });
});

describe('movieLookup popularity tie-break (Task 3)', () => {
  it('bare "Superman" does not pick the far less popular older match', () => {
    const anime = candidate('Superman', {
      id: 1,
      releaseDate: '1991-01-01',
      popularityScore: 3,
      voteCount: 40,
    });
    const popular = candidate('Superman', {
      id: 2,
      releaseDate: '2025-07-11',
      popularityScore: 8000,
      voteCount: 12000,
    });
    const pick = rankCandidates('superman', [anime, popular], NO_HINTS);
    expect(pick?.movie.id).toBe(2);
    expect(pick?.movie.popularityScore).toBe(8000);
  });

  it('ignores popularity when a candidate is below the score floor', () => {
    const unrelated = candidate('Avatar', { id: 1, popularityScore: 9999 });
    expect(rankCandidates('superman', [unrelated], NO_HINTS)).toBeNull();
  });
});

describe('movieLookup year and recency (Task 4)', () => {
  it('extracts and strips a 1900-2099 year from the title query', () => {
    const hints = extractLookupHints('show me Superman 2025 poster', 'Superman 2025');
    expect(hints).toEqual({ year: 2025, wantsNew: false });
    expect(buildLookupQuery('Superman 2025', hints)).toBe('Superman');
  });

  it('rejects years outside the range', () => {
    expect(extractLookupHints('show me Superman 1899 poster', 'Superman 1899').year).toBeNull();
  });

  it('does not read a title word like "New Day" as recency', () => {
    const message = 'Can I see Spider-Man: Brand New Day poster?';
    const title = 'Spider-Man: Brand New Day';
    const hints = extractLookupHints(message, title);
    expect(hints).toEqual({ year: null, wantsNew: false });
    expect(buildLookupQuery(title, hints)).toBe(title);
  });

  it('prefers candidates with the requested release year', () => {
    const old = candidate('Superman', {
      id: 1,
      releaseDate: '1991-01-01',
      popularityScore: 900,
    });
    const target = candidate('Superman', {
      id: 2,
      releaseDate: '2025-07-11',
      popularityScore: 1,
    });
    expect(rankCandidates('superman', [old, target], { year: 2025, wantsNew: false })?.movie.id).toBe(
      2,
    );
  });

  it('prefers the newest non-future date and ignores a future release', () => {
    const future = candidate('Superman', {
      id: 3,
      releaseDate: '2099-01-01',
      popularityScore: 9999,
    });
    const old = candidate('Superman', {
      id: 1,
      releaseDate: '1991-01-01',
      popularityScore: 10,
    });
    const recent = candidate('Superman', {
      id: 2,
      releaseDate: '2025-07-11',
      popularityScore: 1,
    });
    const hints = extractLookupHints('show me the latest Superman poster', 'latest Superman');
    expect(hints.wantsNew).toBe(true);
    expect(buildLookupQuery('latest Superman', hints)).toBe('Superman');
    expect(rankCandidates('superman', [future, old, recent], { year: null, wantsNew: true })?.movie.id).toBe(
      2,
    );
  });
});

describe('movieLookup uncertainty hint (Task 5)', () => {
  it('flags a near-tie that survives popularity and recency tie-breaks', () => {
    const a = candidate('Superman', { id: 1, releaseDate: '2025-01-01', popularityScore: 5 });
    const b = candidate('SUPERMAN', { id: 2, releaseDate: '2025-01-01', popularityScore: 5 });
    const pick = rankCandidates('superman', [a, b], NO_HINTS);
    expect(pick?.uncertain).toBe(true);
    expect(MOVIE_YEAR_HINT_TEXT).toContain('year');
  });

  it('does not flag a clear score winner', () => {
    const a = candidate('Spider-Man', { id: 1, popularityScore: 5 });
    const b = candidate('Spider-Man: Brand New Day', { id: 2, popularityScore: 5 });
    expect(rankCandidates('spidwr man', [a, b], NO_HINTS)?.uncertain).toBe(false);
  });
});

describe('movieLookup title correction (last step)', () => {
  beforeEach(() => {
    mockCorrectMovieTitle.mockReset().mockResolvedValue(null);
    vi.mocked(searchTmdbMovies).mockReset().mockResolvedValue([]);
  });

  it('keeps "corrected" in the closed stage set', () => {
    expect(MOVIE_LOOKUP_STAGES).toContain('corrected');
  });

  it('resolves a typo through the mocked correction and one TMDB search', async () => {
    mockCorrectMovieTitle.mockResolvedValue('The Sound of Music');
    vi.mocked(searchTmdbMovies).mockResolvedValue([
      {
        id: 7,
        title: 'The Sound of Music',
        overview: 'Overview.',
        releaseDate: '1965-01-01',
        runtimeMinutes: 174,
        genres: ['Musical'],
        voteAverage: 8.1,
        posterPath: null,
        backdropPath: null,
      },
    ]);

    const pick = await findCorrectedMovie('sund of music', NO_HINTS);

    expect(pick?.movie.title).toBe('The Sound of Music');
    expect(mockCorrectMovieTitle).toHaveBeenCalledWith('sund of music', 'assistant');
    expect(searchTmdbMovies).toHaveBeenCalledTimes(1);
    expect(searchTmdbMovies).toHaveBeenCalledWith('The Sound of Music');
  });

  it('returns null without searching when correction is null', async () => {
    await expect(findCorrectedMovie('sund of music', NO_HINTS)).resolves.toBeNull();
    expect(searchTmdbMovies).not.toHaveBeenCalled();
  });
});
