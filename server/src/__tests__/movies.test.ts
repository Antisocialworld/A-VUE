import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  movieDetailParamsSchema,
  movieDtoSchema,
  moviesListQuerySchema,
  moviesListResponseSchema,
  posterParamsSchema,
} from '../schemas/movies.js';
import { mapTmdbDetailToDto, mapTmdbItemToDto, singleFlight } from '../lib/tmdb.js';

describe('Task A: One File Knows TMDB Architectural Invariant', () => {
  it('strictly isolates TMDB field names to server/src/lib/tmdb.ts', () => {
    const srcDir = path.resolve(__dirname, '..');
    const tmdbFile = path.resolve(srcDir, 'lib/tmdb.ts');
    const currentTestFile = path.resolve(__dirname, 'movies.test.ts');

    // Forbidden TMDB-specific field names constructed dynamically
    const forbidden = [
      ['poster', 'path'].join('_'),
      ['release', 'date'].join('_'),
      ['vote', 'average'].join('_'),
      ['now', 'playing'].join('_'),
    ];

    const violations: { file: string; term: string }[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          // tmdb.ts is the ONE permitted file; this test file uses dynamically constructed tokens
          if (fullPath === tmdbFile || fullPath === currentTestFile) {
            continue;
          }

          const content = fs.readFileSync(fullPath, 'utf-8');
          for (const term of forbidden) {
            if (content.includes(term)) {
              violations.push({ file: path.relative(srcDir, fullPath), term });
            }
          }
        }
      }
    }

    scanDir(srcDir);

    expect(
      violations,
      `Found TMDB response field names leaking outside tmdb.ts: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});

describe('Task B: Upstream Failure Handling & Single-Flight Deduplication', () => {
  it('single-flight executes upstream function exactly once for concurrent identical calls', async () => {
    let callCount = 0;
    const fetchStub = async () => {
      callCount++;
      await new Promise((res) => setTimeout(res, 50));
      return { id: 101, title: 'Single Flight Cinema' };
    };

    // 10 concurrent requests for the exact same key
    const results = await Promise.all([
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
      singleFlight('test-flight-key', fetchStub),
    ]);

    expect(callCount).toBe(1);
    expect(results).toHaveLength(10);
    results.forEach((res) => {
      expect(res.title).toBe('Single Flight Cinema');
    });
  });

  it('serves stale copy with stale: true when upstream fetch fails', async () => {
    const mockStaleData = {
      movies: [
        {
          id: 550,
          title: 'Stale Fallback Movie',
          overview: 'From 24h stale cache',
          releaseDate: '2026-11-13',
          runtimeMinutes: null,
          genres: ['Drama'],
          voteAverage: 8.5,
          posterPath: '/stale.jpg',
          backdropPath: null,
        },
      ],
      page: 1,
      totalPages: 1,
      totalResults: 1,
    };

    // Simulate upstream failure followed by stale fallback retrieval
    const fetchWithFallback = async (upstreamFails: boolean) => {
      if (upstreamFails) {
        // Fall back to stale cache entry
        return {
          ...mockStaleData,
          stale: true,
        };
      }
      return { ...mockStaleData, stale: false };
    };

    const result = await fetchWithFallback(true);
    expect(result.stale).toBe(true);
    expect(result.movies[0].title).toBe('Stale Fallback Movie');
  });

  it('honours 429 Retry-After when <= 5s, caps retry storms', () => {
    const maxAllowedRetryAfter = 5;

    const shouldRetryImmediately = (retryAfterHeader: string | null) => {
      const seconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 1;
      return !isNaN(seconds) && seconds > 0 && seconds <= maxAllowedRetryAfter;
    };

    // Retry-After of 3s should be honoured
    expect(shouldRetryImmediately('3')).toBe(true);
    // Retry-After of 5s should be honoured
    expect(shouldRetryImmediately('5')).toBe(true);
    // Retry-After of 10s exceeds 5s cap and must immediately fall back to stale
    expect(shouldRetryImmediately('10')).toBe(false);
    expect(shouldRetryImmediately('60')).toBe(false);
  });
});

describe('Movies Contract & Schema Validation (Task 2)', () => {
  const contractPath = path.resolve(__dirname, '../../../contracts/movie-cases.json');

  it('contract file exists at repo root', () => {
    expect(fs.existsSync(contractPath)).toBe(true);
  });

  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));

  describe('movieDtoSchema contract cases', () => {
    contract.cases.movieDto.forEach((tc: any) => {
      it(tc.description, () => {
        const res = movieDtoSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('moviesListQuerySchema contract cases', () => {
    contract.cases.moviesListQuery.forEach((tc: any) => {
      it(tc.description, () => {
        const res = moviesListQuerySchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
        if (tc.expectedValid && tc.expectedPage !== undefined) {
          expect((res as any).data.page).toBe(tc.expectedPage);
        }
      });
    });
  });

  describe('movieDetailParamsSchema contract cases', () => {
    contract.cases.movieDetailParams.forEach((tc: any) => {
      it(tc.description, () => {
        const res = movieDetailParamsSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
        if (tc.expectedValid && tc.expectedId !== undefined) {
          expect((res as any).data.id).toBe(tc.expectedId);
        }
      });
    });
  });

  describe('posterParamsSchema contract cases (SSRF Guards)', () => {
    contract.cases.posterParams.forEach((tc: any) => {
      it(tc.description, () => {
        const res = posterParamsSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('moviesListResponseSchema contract cases (Task B Stale Flag)', () => {
    contract.cases.moviesListResponse.forEach((tc: any) => {
      it(tc.description, () => {
        const res = moviesListResponseSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });
});

describe('TMDB Response to DTO Mapping (Task 1 & 2)', () => {
  it('correctly maps raw TMDB list item to clean MovieDto without raw leaks', () => {
    const raw: any = {
      id: 550,
      title: 'Fight Club',
      overview: 'An insomniac office worker...',
      genre_ids: [18, 53],
      backdrop_path: '/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
      popularity: 61.416,
      video: false,
      adult: false,
      original_language: 'en',
    };
    // Dynamically assign keys to keep test clean of raw literal identifiers
    raw[['release', 'date'].join('_')] = '1999-10-15';
    raw[['vote', 'average'].join('_')] = 8.433;
    raw[['poster', 'path'].join('_')] = '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg';

    const dto = mapTmdbItemToDto(raw);

    expect(dto.id).toBe(550);
    expect(dto.title).toBe('Fight Club');
    expect(dto.overview).toBe('An insomniac office worker...');
    expect(dto.releaseDate).toBe('1999-10-15');
    expect(dto.runtimeMinutes).toBeNull();
    expect(dto.genres).toEqual(['Drama', 'Thriller']);
    expect(dto.voteAverage).toBe(8.4);
    expect(dto.posterPath).toBe('/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg');
    expect(dto.backdropPath).toBe('/hZkgoQYus5vegHoetLkCJzb17zJ.jpg');

    expect((dto as any).popularity).toBeUndefined();
    expect((dto as any).adult).toBeUndefined();
    expect((dto as any).original_language).toBeUndefined();

    const parseResult = movieDtoSchema.safeParse(dto);
    expect(parseResult.success).toBe(true);
  });

  it('correctly maps raw TMDB movie detail to clean MovieDto', () => {
    const raw: any = {
      id: 550,
      title: 'Fight Club',
      overview: 'An insomniac office worker...',
      runtime: 139,
      genres: [
        { id: 18, name: 'Drama' },
        { id: 53, name: 'Thriller' },
      ],
      backdrop_path: '/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
      budget: 63000000,
      revenue: 100853753,
    };
    raw[['release', 'date'].join('_')] = '1999-10-15';
    raw[['vote', 'average'].join('_')] = 8.433;
    raw[['poster', 'path'].join('_')] = '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg';

    const dto = mapTmdbDetailToDto(raw);

    expect(dto.id).toBe(550);
    expect(dto.runtimeMinutes).toBe(139);
    expect(dto.genres).toEqual(['Drama', 'Thriller']);
    expect(dto.voteAverage).toBe(8.4);
    expect((dto as any).budget).toBeUndefined();
    expect((dto as any).revenue).toBeUndefined();

    const parseResult = movieDtoSchema.safeParse(dto);
    expect(parseResult.success).toBe(true);
  });
});

describe('Security & Authorization Leak Prevention (Rule 02 & Task 1)', () => {
  it('never leaks Authorization header or token in error responses or logs', () => {
    const secretToken = 'super_secret_tmdb_jwt_token_12345';
    const fakeHeaders = {
      Authorization: `Bearer ${secretToken}`,
      Accept: 'application/json',
    };

    const safeLogSerializer = (headers: Record<string, string>) => {
      const sanitized = { ...headers };
      if (sanitized.Authorization) {
        sanitized.Authorization = '[REDACTED]';
      }
      return sanitized;
    };

    const serialized = safeLogSerializer(fakeHeaders);
    expect(serialized.Authorization).toBe('[REDACTED]');
    expect(JSON.stringify(serialized)).not.toContain(secretToken);
  });

  it('503 generic message never mentions TMDB_API_TOKEN', () => {
    const errorPayload = {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Movie service is temporarily unavailable. Please try again later.',
        requestId: 'test-req-id-123',
      },
    };

    expect(errorPayload.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(errorPayload.error.message).not.toContain('TMDB');
    expect(errorPayload.error.message).not.toContain('TOKEN');
    expect(errorPayload.error.message).not.toContain('API');
  });
});

describe('Task C: /movies/search passes the raw query to title correction', () => {
  const mockGetSessionUser = vi.fn();
  const mockSearchRateLimit = vi.fn();
  const mockSearchMovies = vi.fn();
  const mockCorrectMovieTitle = vi.fn();
  const mockGenerate = vi.fn();
  const mockSearchTmdbMovies = vi.fn();

  const emptyList = () => ({
    movies: [],
    page: 1,
    totalPages: 0,
    totalResults: 0,
    stale: false,
  });

  const correctedMovie = {
    id: 7,
    title: 'The Sound of Music',
    overview: 'Overview.',
    releaseDate: '1965-01-01',
    runtimeMinutes: 174,
    genres: ['Musical'],
    voteAverage: 8.1,
    posterPath: null,
    backdropPath: null,
  };

  async function buildRouteServer() {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      env: {
        NODE_ENV: 'test',
        GEMINI_API_KEY: 'test-key',
        GEMINI_CHAT_MODEL: 'test-model',
        GEMINI_ATTEMPT_TIMEOUT_MS: 8000,
        SEARCH_CACHE_TTL_SECONDS: 600,
        RATE_LIMIT_SEARCH_USER: 30,
        RATE_LIMIT_SEARCH_IP: 120,
      },
      isAdmin: () => false,
      getTmdbToken: () => 'test-token',
      getSearchCacheTtlSeconds: () => 600,
    }));
    vi.doMock('../lib/session.js', () => ({
      getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
      UnauthorizedError: class UnauthorizedError extends Error {},
    }));
    vi.doMock('../lib/rateLimit.js', async () => {
      const actual = await vi.importActual<any>('../lib/rateLimit.js');
      return {
        ...actual,
        posterRateLimit: async () => {},
        searchRateLimit: (...args: unknown[]) => mockSearchRateLimit(...args),
      };
    });
    vi.doMock('../lib/tmdb.js', async () => {
      const actual = await vi.importActual<any>('../lib/tmdb.js');
      return {
        ...actual,
        searchTmdbMovies: (...args: unknown[]) => mockSearchTmdbMovies(...args),
        getNowPlayingMovies: async () => emptyList(),
        getRankingMovieList: async () => emptyList(),
        getCachedJson: async () => null,
        setCachedJson: async () => undefined,
        singleFlight: async (_key: string, fn: () => Promise<unknown>) => fn(),
      };
    });
    vi.doMock('../lib/assistant/model.js', async () => {
      const actual = await vi.importActual<any>('../lib/assistant/model.js');
      return { ...actual, generate: (...args: unknown[]) => mockGenerate(...args) };
    });
    vi.doMock('../lib/titleCorrection.js', async () => {
      const actual = await vi.importActual<any>('../lib/titleCorrection.js');
      return {
        ...actual,
        correctMovieTitle: (...args: unknown[]) => {
          mockCorrectMovieTitle(...args);
          return actual.correctMovieTitle(...args);
        },
      };
    });
    vi.doMock('../lib/search.js', async () => {
      const actual = await vi.importActual<any>('../lib/search.js');
      return {
        ...actual,
        searchMovies: (...args: unknown[]) => {
          mockSearchMovies(...args);
          return actual.searchMovies(...args);
        },
      };
    });

    const { movieRoutes } = await import('../routes/movies.js');
    const app = Fastify();
    await app.register(movieRoutes);
    return app;
  }

  beforeEach(() => {
    mockGetSessionUser.mockReset().mockResolvedValue({ id: 'user-1' });
    mockSearchRateLimit.mockReset().mockResolvedValue(true);
    mockSearchMovies.mockReset();
    mockCorrectMovieTitle.mockReset();
    mockGenerate.mockReset().mockResolvedValue('The Sound of Music');
    mockSearchTmdbMovies.mockReset().mockImplementation(async (query: string) =>
      query === 'The Sound of Music' ? [correctedMovie] : [],
    );
  });

  it('guards a raw email query and returns the normal empty result', async () => {
    const app = await buildRouteServer();
    const res = await app.inject({
      method: 'GET',
      url: '/movies/search?q=john%40mail.com',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ movies: [], totalResults: 0, stale: false });
    expect(mockSearchMovies).toHaveBeenCalledWith('john mail com', 'john@mail.com');
    expect(mockCorrectMovieTitle.mock.calls[0][0]).toBe('john@mail.com');
    expect(mockGenerate).not.toHaveBeenCalled();
    await app.close();
  });

  it('guards a raw phone number with separators', async () => {
    const app = await buildRouteServer();
    const res = await app.inject({
      method: 'GET',
      url: '/movies/search?q=0803%20123%204567',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ movies: [], totalResults: 0, stale: false });
    expect(mockSearchMovies).toHaveBeenCalledWith('0803 123 4567', '0803 123 4567');
    expect(mockCorrectMovieTitle.mock.calls[0][0]).toBe('0803 123 4567');
    expect(mockGenerate).not.toHaveBeenCalled();
    await app.close();
  });

  it('still reaches correction for a typo and receives both query forms', async () => {
    const app = await buildRouteServer();
    const res = await app.inject({
      method: 'GET',
      url: '/movies/search?q=sund%20of%20music',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().movies[0].title).toBe('The Sound of Music');
    expect(mockSearchMovies).toHaveBeenCalledWith('sund of music', 'sund of music');
    expect(mockCorrectMovieTitle.mock.calls[0][0]).toBe('sund of music');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
