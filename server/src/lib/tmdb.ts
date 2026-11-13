import crypto from 'node:crypto';
import { z } from 'zod';
import { getTmdbToken } from '../env.js';
import { getRedisClient } from './redis.js';
import { MovieDto, MoviesListResponse } from '../schemas/movies.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT_MS = 5000; // 5s timeout

// Cache TTL specifications (Task B & ARCHITECTURE.md)
const FRESH_LIST_TTL_SECONDS = 600; // 10 minutes fresh
const STALE_LIST_TTL_SECONDS = 86400; // 24 hours stale fallback
const FRESH_DETAIL_TTL_SECONDS = 3600; // 60 minutes fresh
const STALE_DETAIL_TTL_SECONDS = 604800; // 7 days stale fallback
const MAX_429_RETRY_AFTER_SECONDS = 5; // Capped at 5s to prevent retry storms

// Standard TMDB v3 genre mapping for list view
const TMDB_GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

// Raw TMDB Now Playing item schema (ONLY known in this file per Task A)
const rawTmdbMovieItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  overview: z.string().optional().default(''),
  release_date: z.string().optional().default(''),
  genre_ids: z.array(z.number()).optional().default([]),
  vote_average: z.number().optional().default(0),
  poster_path: z.string().nullable().optional().default(null),
  backdrop_path: z.string().nullable().optional().default(null),
});

// Raw TMDB Now Playing response schema
const rawTmdbNowPlayingResponseSchema = z.object({
  results: z.array(rawTmdbMovieItemSchema),
  page: z.number(),
  total_pages: z.number(),
  total_results: z.number(),
});

// Raw TMDB Movie Detail schema (ONLY known in this file per Task A)
const rawTmdbMovieDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  overview: z.string().optional().default(''),
  release_date: z.string().optional().default(''),
  runtime: z.number().nullable().optional().default(null),
  genres: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
      }),
    )
    .optional()
    .default([]),
  vote_average: z.number().optional().default(0),
  poster_path: z.string().nullable().optional().default(null),
  backdrop_path: z.string().nullable().optional().default(null),
});

/**
 * Single-flight request deduplication map.
 * Guarantees concurrent identical requests share exactly one upstream call (Task B).
 */
const inFlightRequests = new Map<string, Promise<any>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }
  const promise = fn().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * Maps raw TMDB now playing item to clean internal MovieDto.
 * Strips all internal TMDB fields.
 */
export function mapTmdbItemToDto(raw: z.infer<typeof rawTmdbMovieItemSchema>): MovieDto {
  const genres = raw.genre_ids
    .map((id) => TMDB_GENRE_MAP[id])
    .filter((name): name is string => Boolean(name));

  const voteAverage = Math.min(10, Math.max(0, Math.round(raw.vote_average * 10) / 10));

  return {
    id: raw.id,
    title: raw.title,
    overview: raw.overview,
    releaseDate: raw.release_date,
    runtimeMinutes: null,
    genres,
    voteAverage,
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
  };
}

/**
 * Maps raw TMDB movie detail to clean internal MovieDto.
 * Strips all internal TMDB fields.
 */
export function mapTmdbDetailToDto(raw: z.infer<typeof rawTmdbMovieDetailSchema>): MovieDto {
  const genres = raw.genres.map((g) => g.name);
  const voteAverage = Math.min(10, Math.max(0, Math.round(raw.vote_average * 10) / 10));

  return {
    id: raw.id,
    title: raw.title,
    overview: raw.overview,
    releaseDate: raw.release_date,
    runtimeMinutes: raw.runtime ?? null,
    genres,
    voteAverage,
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
  };
}

/**
 * Safe Redis JSON get helper.
 */
async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisClient();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => { });
    }
    const data = await redis.get(key);
    return data ? (JSON.parse(data) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Safe Redis JSON set helper.
 */
async function setCachedJson(key: string, data: any, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedisClient();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => { });
    }
    await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Executes an HTTP fetch against TMDB with a 5s timeout, one retry on 5xx or timeout,
 * and 429 Retry-After handling capped at 5s.
 * Jittered backoff uses crypto.randomBytes (Rule 02: Math.random banned).
 * Never logs Authorization header or secrets.
 */
async function fetchWithRetryAndBackoff(url: string, token: string): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  const doAttempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let response: Response;
  try {
    response = await doAttempt();
  } catch (firstErr: any) {
    // One retry with crypto-based jittered backoff (200ms + 0..250ms)
    const jitter = crypto.randomBytes(2).readUInt16BE(0) % 250;
    await new Promise((resolve) => setTimeout(resolve, 200 + jitter));
    response = await doAttempt();
  }

  // Handle 429 Too Many Requests (Task B)
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 1;

    // Honour Retry-After capped at 5s; no retry storms
    if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= MAX_429_RETRY_AFTER_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      response = await doAttempt();
    } else {
      throw new Error(`TMDB_RATE_LIMITED: 429 Retry-After ${retryAfterSeconds}s exceeds 5s cap`);
    }
  }

  if (response.status >= 500) {
    throw new Error(`Upstream TMDB 5xx response: ${response.status}`);
  }

  return response;
}

/**
 * Fetches now playing movies (pages 1 to 5) with:
 * - Fresh Redis cache (10 min)
 * - Stale copy beside it (24 h)
 * - Single-flight concurrent request deduplication
 * - Graceful fallback to stale on failure with stale: true
 */
export async function getNowPlayingMovies(page = 1): Promise<MoviesListResponse> {
  const token = getTmdbToken();
  if (!token) {
    throw new Error('TMDB_TOKEN_MISSING');
  }

  const freshKey = `tmdb:list:${page}`;
  const staleKey = `tmdb:list:${page}:stale`;

  // 1. Check fresh cache
  const cachedFresh = await getCachedJson<MoviesListResponse>(freshKey);
  if (cachedFresh) {
    return { ...cachedFresh, stale: false };
  }

  // 2. Single-flight upstream fetch
  const flightKey = `list:${page}`;
  return singleFlight(flightKey, async () => {
    // Re-check fresh cache inside single-flight block
    const recheck = await getCachedJson<MoviesListResponse>(freshKey);
    if (recheck) {
      return { ...recheck, stale: false };
    }

    try {
      const url = `${TMDB_BASE_URL}/movie/now_playing?language=en-US&page=${page}`;
      const response = await fetchWithRetryAndBackoff(url, token);

      if (!response.ok) {
        throw new Error(`TMDB upstream error: ${response.status}`);
      }

      const rawJson = await response.json();
      const parsed = rawTmdbNowPlayingResponseSchema.parse(rawJson);
      const movies = parsed.results.map(mapTmdbItemToDto);

      const result: MoviesListResponse = {
        movies,
        page: parsed.page,
        totalPages: Math.min(parsed.total_pages, 5),
        totalResults: parsed.total_results,
        stale: false,
      };

      // Store fresh copy (10 min) and stale copy (24 h)
      await setCachedJson(freshKey, result, FRESH_LIST_TTL_SECONDS);
      await setCachedJson(staleKey, result, STALE_LIST_TTL_SECONDS);

      return result;
    } catch (upstreamErr: any) {
      process.stderr.write(`[TMDB Client Warning] Upstream list failed: ${upstreamErr.message}. Serving stale copy if present.\n`);

      // Fall back to stale copy (24 h TTL)
      const cachedStale = await getCachedJson<MoviesListResponse>(staleKey);
      if (cachedStale) {
        return { ...cachedStale, stale: true };
      }

      // No stale copy: throw clear error for app error state with Retry
      throw new Error('TMDB_UNAVAILABLE');
    }
  });
}

/**
 * Fetches movie details by ID with:
 * - Fresh Redis cache (60 min)
 * - Stale copy beside it (7 days)
 * - Single-flight concurrent request deduplication
 * - Graceful fallback to stale on failure with stale: true
 */
export async function getMovieDetails(id: number): Promise<{ movie: MovieDto; stale?: boolean } | null> {
  const token = getTmdbToken();
  if (!token) {
    throw new Error('TMDB_TOKEN_MISSING');
  }

  const freshKey = `tmdb:movie:${id}`;
  const staleKey = `tmdb:movie:${id}:stale`;

  // 1. Check fresh cache
  const cachedFresh = await getCachedJson<MovieDto>(freshKey);
  if (cachedFresh) {
    return { movie: cachedFresh, stale: false };
  }

  // 2. Single-flight upstream fetch
  const flightKey = `movie:${id}`;
  return singleFlight(flightKey, async () => {
    // Re-check fresh cache inside single-flight block
    const recheck = await getCachedJson<MovieDto>(freshKey);
    if (recheck) {
      return { movie: recheck, stale: false };
    }

    try {
      const url = `${TMDB_BASE_URL}/movie/${id}?language=en-US`;
      let response: Response;
      try {
        response = await fetchWithRetryAndBackoff(url, token);
      } catch (err: any) {
        if (err.message?.includes('404')) {
          return null;
        }
        throw err;
      }

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`TMDB upstream error: ${response.status}`);
      }

      const rawJson = await response.json();
      const parsed = rawTmdbMovieDetailSchema.parse(rawJson);
      const movie = mapTmdbDetailToDto(parsed);

      // Store fresh copy (60 min) and stale copy (7 days)
      await setCachedJson(freshKey, movie, FRESH_DETAIL_TTL_SECONDS);
      await setCachedJson(staleKey, movie, STALE_DETAIL_TTL_SECONDS);

      return { movie, stale: false };
    } catch (upstreamErr: any) {
      process.stderr.write(`[TMDB Client Warning] Upstream detail failed: ${upstreamErr.message}. Serving stale copy if present.\n`);

      // Fall back to stale copy (7 days TTL)
      const cachedStale = await getCachedJson<MovieDto>(staleKey);
      if (cachedStale) {
        return { movie: cachedStale, stale: true };
      }

      throw new Error('TMDB_UNAVAILABLE');
    }
  });
}
