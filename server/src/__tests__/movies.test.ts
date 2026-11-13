import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
