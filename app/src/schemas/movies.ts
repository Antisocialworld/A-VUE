import { z } from 'zod';

/**
 * App Movie Zod Schemas & DTOs
 * Identical to server/src/schemas/movies.ts.
 * Rule: Unknown fields rejected (.strict()).
 * Never forward raw TMDB JSON to clients.
 */

// Single Movie DTO Schema
export const movieDtoSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1),
    overview: z.string(),
    releaseDate: z.string(),
    runtimeMinutes: z.number().int().nonnegative().nullable(),
    genres: z.array(z.string()),
    voteAverage: z.number().min(0).max(10),
    posterPath: z.string().nullable(),
    backdropPath: z.string().nullable(),
  })
  .strict();

export type MovieDto = z.infer<typeof movieDtoSchema>;

// Movies List Query Schema (page 1 to 5, default 1)
export const moviesListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(5).default(1),
  })
  .strict();

export type MoviesListQuery = z.infer<typeof moviesListQuerySchema>;

// Movies List Response Schema
export const moviesListResponseSchema = z
  .object({
    movies: z.array(movieDtoSchema),
    page: z.number().int().min(1).max(5),
    totalPages: z.number().int().nonnegative(),
    totalResults: z.number().int().nonnegative(),
    stale: z.boolean().optional().default(false),
  })
  .strict();

export type MoviesListResponse = z.infer<typeof moviesListResponseSchema>;

// Movie Detail Params Schema (positive integer id)
export const movieDetailParamsSchema = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

export type MovieDetailParams = z.infer<typeof movieDetailParamsSchema>;

// Movie Detail Response Schema
export const movieDetailResponseSchema = z
  .object({
    movie: movieDtoSchema,
    stale: z.boolean().optional().default(false),
  })
  .strict();

export type MovieDetailResponse = z.infer<typeof movieDetailResponseSchema>;

// Poster Proxy Params Schema (size in w185, w342, w500; file matches regex)
export const posterParamsSchema = z
  .object({
    size: z.enum(['w185', 'w342', 'w500']),
    file: z.string().regex(/^[A-Za-z0-9_-]{5,64}\.jpg$/),
  })
  .strict();

export type PosterParams = z.infer<typeof posterParamsSchema>;

