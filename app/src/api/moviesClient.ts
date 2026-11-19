import {
  MovieDetailResponse,
  MovieDto,
  MoviesListResponse,
  MoviesSearchResponse,
  movieDetailResponseSchema,
  moviesListResponseSchema,
  moviesSearchResponseSchema,
} from '../schemas/movies';
import { STRINGS } from '../constants/strings';
import { getSessionToken } from '../lib/secureStore';
import { handleUnauthorized } from '../lib/sessionExpired';

export class MoviesClient {
  private getBaseUrl(): string {
    const url = process.env.EXPO_PUBLIC_API_URL;
    const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

    if (!url || !url.trim()) {
      if (isDev) {
        throw new Error(
          'EXPO_PUBLIC_API_URL environment variable is missing. Please define EXPO_PUBLIC_API_URL in app/.env',
        );
      }
      throw new Error(STRINGS.common.genericError);
    }
    const trimmed = url.trim();

    // In production (not __DEV__), require https and refuse http
    if (!isDev && !trimmed.startsWith('https://')) {
      throw new Error(STRINGS.common.genericError);
    }
    return trimmed;
  }

  /**
   * Helper to construct internal proxy poster URLs so the app NEVER contacts TMDB or its CDN.
   * Host is fixed to our own backend server.
   */
  public getPosterUrl(size: 'w185' | 'w342' | 'w500', posterPath: string | null | undefined): string | null {
    if (!posterPath || !posterPath.trim()) {
      return null;
    }
    const cleanFile = posterPath.trim().replace(/^\//, '');
    return `${this.getBaseUrl()}/movies/poster/${size}/${cleanFile}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const token = await getSessionToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per Rule 02

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Only an authenticated 401 ends the session; ordinary errors and public calls are unchanged.
        await handleUnauthorized(response.status);
        const errorMsg = data?.error?.message || STRINGS.common.genericError;
        const error = new Error(errorMsg) as any;
        error.code = data?.error?.code;
        error.status = response.status;
        const retryAfterHeader = response.headers?.get?.('retry-after');
        if (retryAfterHeader) {
          const parsed = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsed)) {
            error.retryAfter = parsed;
          }
        }
        throw error;
      }

      return data as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const timeoutError = new Error(STRINGS.errors.requestTimeout) as any;
        timeoutError.name = 'AbortError';
        timeoutError.status = 0;
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetches now playing movies with pagination (pages 1 to 5)
   */
  public async getMovies(page = 1): Promise<MoviesListResponse> {
    const data = await this.request<any>(`/movies?page=${page}`, {
      method: 'GET',
    });
    return moviesListResponseSchema.parse(data);
  }

  /**
   * Fetches single movie detail by positive integer ID
   */
  public async getMovie(id: number): Promise<MovieDto> {
    const data = await this.request<MovieDetailResponse>(`/movies/${id}`, {
      method: 'GET',
    });
    const parsed = movieDetailResponseSchema.parse(data);
    return parsed.movie;
  }

  /**
   * Searches movies with typo-tolerant ranking
   */
  public async searchMovies(query: string): Promise<MoviesSearchResponse> {
    const encoded = encodeURIComponent(query);
    const data = await this.request<any>(`/movies/search?q=${encoded}`, {
      method: 'GET',
    });
    return moviesSearchResponseSchema.parse(data);
  }
}

export const moviesClient = new MoviesClient();

