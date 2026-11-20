import type { MovieDto, MoviesListResponse } from '../../schemas/movies.js';
import { calculateSearchScore, normalizeSearchText } from '../search.js';
import {
  getNowPlayingMovies,
  getRankingMovieList,
  searchTmdbMovies,
  type CandidateMovie,
  type RankingListName,
} from '../tmdb.js';
import { correctMovieTitle } from '../titleCorrection.js';

export const MOVIE_FOUND_TEXT = 'Here is what I found.';
export const MOVIE_NOT_FOUND_TEXT = "I couldn't find that movie. Try the Search screen in A VUE.";
export const MOVIE_UNAVAILABLE_TEXT = 'Movie details are unavailable right now. Try again shortly.';
// Server-side assistant text (no app strings.ts surface for this route).
export const MOVIE_YEAR_HINT_TEXT = 'You can add the year to narrow it down.';
export const WEAK_MATCH_MIN_SCORE = 0.85;
// Evidence (calculateSearchScore): valid typo titles score 0.51-0.85, unrelated strings score 0.
export const RELAXED_MATCH_MIN_SCORE = 0.5;

// Closed set for the movie-lookup log field; 'none' covers both no-match and error verdicts.
export const MOVIE_LOOKUP_STAGES = ['search', 'relaxed', 'cached', 'pool', 'corrected', 'none'] as const;
export type MovieLookupStage = (typeof MOVIE_LOOKUP_STAGES)[number];

export const MOVIE_LOOKUP_STOP_TITLES: ReadonlySet<string> = new Set([
  'cinema',
  'the cinema',
  'a vue',
  'avue',
  // "a vue" can strip to this form during title extraction.
  'vue',
  'app',
  'the app',
  'you',
  'yourself',
  'it',
  'this',
  'that',
  'movies',
  'films',
  'tickets',
]);

export function isSearchableMovieTitle(title: string): boolean {
  const normalized = normalizeSearchText(title);
  return normalized.length > 0 && !MOVIE_LOOKUP_STOP_TITLES.has(normalized);
}

export type MovieIntent = 'strong' | 'weak' | 'none';

export type MovieSummary = {
  tmdbId: number;
  title: string;
  year: string | null;
  overview: string;
  posterPath: string | null;
};

const STRONG_WORDS = [
  'poster',
  'posters',
  'image',
  'images',
  'picture',
  'pictures',
  'photo',
  'photos',
  'artwork',
  'trailer',
] as const;

const WEAK_PHRASES = [
  'show me',
  'can i see',
  'let me see',
  'what does',
  'look like',
  'tell me about',
  'about the movie',
  'about the film',
  'synopsis',
  'plot of',
  'overview of',
] as const;

const FILLER_WORDS = [
  'a',
  'an',
  'the',
  'of',
  'for',
  'please',
  'can',
  'i',
  'you',
  'me',
  'show',
  'see',
  'let',
  'movie',
  'film',
  'movies',
  'films',
  'poster',
] as const;

const MAX_TITLE_LENGTH = 100;
const MAX_OVERVIEW_LENGTH = 300;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SORTED_STRONG_WORDS = [...STRONG_WORDS].sort((a, b) => b.length - a.length);
const STRONG_RE = new RegExp(`\\b(?:${SORTED_STRONG_WORDS.join('|')})\\b`, 'i');

const SORTED_WEAK_PHRASES = [...WEAK_PHRASES].sort((a, b) => b.length - a.length);
const weakPattern = (phrase: string): string =>
  phrase.split(/\s+/).map(escapeRegExp).join('\\s+');
const WEAK_PATTERNS = SORTED_WEAK_PHRASES.map(weakPattern);
const WEAK_ANY_RES = WEAK_PATTERNS.map((pattern) => new RegExp(`\\b${pattern}\\b`, 'i'));
const WEAK_START_RES = WEAK_PATTERNS.map((pattern) => new RegExp(`^${pattern}\\b`, 'i'));
const WEAK_END_RES = WEAK_PATTERNS.map((pattern) => new RegExp(`\\b${pattern}$`, 'i'));

const STRIP_WORDS = [...new Set([...FILLER_WORDS, ...STRONG_WORDS])].sort(
  (a, b) => b.length - a.length,
);
const START_WORD_RE = new RegExp(`^(?:${STRIP_WORDS.join('|')})\\b`, 'i');
const END_WORD_RE = new RegExp(`\\b(?:${STRIP_WORDS.join('|')})$`, 'i');
const EDGE_PUNCTUATION_RE = /^[!?.,;:]+|[!?.,;:]+$/g;

export function detectMovieIntent(message: string): MovieIntent {
  if (STRONG_RE.test(message)) return 'strong';
  if (WEAK_ANY_RES.some((pattern) => pattern.test(message))) return 'weak';
  return 'none';
}

export function extractMovieTitle(message: string): string | null {
  if (detectMovieIntent(message) === 'none') return null;
  let title = message.trim();
  let changed = true;

  while (changed) {
    changed = false;
    title = title.replace(EDGE_PUNCTUATION_RE, '').trim();

    for (let i = 0; i < SORTED_WEAK_PHRASES.length; i += 1) {
      if (WEAK_START_RES[i].test(title)) {
        title = title.replace(WEAK_START_RES[i], '').trim();
        changed = true;
        break;
      }
      if (WEAK_END_RES[i].test(title)) {
        title = title.replace(WEAK_END_RES[i], '').trim();
        changed = true;
        break;
      }
    }
    if (changed) continue;

    if (START_WORD_RE.test(title)) {
      title = title.replace(START_WORD_RE, '').trim();
      changed = true;
      continue;
    }
    if (END_WORD_RE.test(title)) {
      title = title.replace(END_WORD_RE, '').trim();
      changed = true;
    }
  }

  title = title.replace(EDGE_PUNCTUATION_RE, '').trim();
  if (title.length < 2 || title.length > MAX_TITLE_LENGTH) return null;
  return title;
}

function truncateOverview(overview: string): string {
  if (overview.length <= MAX_OVERVIEW_LENGTH) return overview;
  const cut = overview.slice(0, MAX_OVERVIEW_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function posterFileName(posterPath: string | null): string | null {
  if (!posterPath) return null;
  return posterPath.split(/[/?#\\]/).filter(Boolean).pop() ?? null;
}

export function toMovieSummary(movie: MovieDto): MovieSummary {
  return {
    tmdbId: movie.id,
    title: movie.title,
    year: movie.releaseDate.length >= 4 ? movie.releaseDate.slice(0, 4) : null,
    overview: truncateOverview(movie.overview),
    posterPath: posterFileName(movie.posterPath),
  };
}

/**
 * At most one relaxed retry: keep the first two title words. This drops trailing intent
 * words such as "image or" while preserving the distinguishing title words for TMDB.
 */
export function relaxedSearchQuery(title: string): string | null {
  const words = normalizeSearchText(title).split(' ').filter(Boolean);
  return words.length > 0 ? words.slice(0, 2).join(' ') : null;
}

/** Weak intent keeps its stricter score; the relaxed strong path uses the evidence-based floor. */
export function isAcceptableRelaxedMatch(
  title: string,
  candidateTitle: string,
  intent: 'strong' | 'weak',
): boolean {
  const threshold = intent === 'weak' ? WEAK_MATCH_MIN_SCORE : RELAXED_MATCH_MIN_SCORE;
  return calculateSearchScore(title, candidateTitle) >= threshold;
}

export async function findRelaxedMovie(
  title: string,
  intent: 'strong' | 'weak',
  search: (query: string) => Promise<{ movies: MovieDto[] }>,
): Promise<MovieDto | null> {
  const query = relaxedSearchQuery(title);
  if (!query) return null;
  try {
    const result = await search(query);
    return result.movies.find((movie) => isAcceptableRelaxedMatch(title, movie.title, intent)) ?? null;
  } catch {
    // A failed retry is simply "no match"; the first-search error path is unchanged.
    return null;
  }
}

export type NowPlayingListReader = () => Promise<MoviesListResponse>;

/**
 * Last fallback step: score the extracted title against the now-playing list returned by
 * the shared TMDB adapter (fresh cache, stale fallback and errors handled there).
 * Strong intent only (0.5 floor); weak intent keeps its 0.85 rule and never calls it.
 * An empty or failed list is skipped silently; a single call per lookup at most.
 */
export async function findCachedMovie(
  title: string,
  intent: 'strong' | 'weak',
  readList: NowPlayingListReader = getNowPlayingMovies,
): Promise<MovieDto | null> {
  if (intent !== 'strong') return null;
  try {
    const list = await readList();
    if (!list || !Array.isArray(list.movies) || list.movies.length === 0) return null;
    let best: { movie: MovieDto; score: number } | null = null;
    for (const movie of list.movies) {
      const score = calculateSearchScore(title, movie.title);
      if (score >= RELAXED_MATCH_MIN_SCORE && (best === null || score > best.score)) {
        best = { movie, score };
      }
    }
    return best?.movie ?? null;
  } catch {
    return null;
  }
}

const YEAR_RE = /\b(?:19\d{2}|20\d{2})\b/;
const YEAR_RE_GLOBAL = /\b(?:19\d{2}|20\d{2})\b/g;
const RECENCY_RE = /\b(?:latest|recent|most\s+recent)\b/i;
const LEADING_NEW_RE = /^new\b/i;
const RECENCY_QUERY_RE = /\b(?:most\s+recent|latest|recent|new)\b/gi;

/** Year and recency hints come from the user message; title is the extracted title text. */
export type LookupHints = { year: number | null; wantsNew: boolean };

export function extractLookupHints(message: string, title: string): LookupHints {
  const found = message.match(YEAR_RE);
  const year = found ? Number(found[0]) : null;
  return {
    year: year !== null && year >= 1900 && year <= 2099 ? year : null,
    // "Brand New Day" is a title, not a recency hint; only a leading "new" counts.
    wantsNew: RECENCY_RE.test(message) || LEADING_NEW_RE.test(title.trim()),
  };
}

/** Strip modifier tokens so TMDB receives the title only; no new upstream parameters. */
export function buildLookupQuery(title: string, hints: LookupHints): string {
  let query = title.replace(YEAR_RE_GLOBAL, ' ');
  if (hints.wantsNew) query = query.replace(RECENCY_QUERY_RE, ' ');
  return query.replace(/\s+/g, ' ').trim() || title.trim();
}

/** Adds zero-valued internal signals to a plain DTO; signals never enter MovieDto. */
export function toCandidate(movie: MovieDto | CandidateMovie): CandidateMovie {
  const signals = movie as Partial<CandidateMovie>;
  return {
    ...movie,
    popularityScore: signals.popularityScore ?? 0,
    voteCount: signals.voteCount ?? 0,
  };
}

export type RankedPick = { movie: CandidateMovie; score: number; uncertain: boolean };

/** Local-only ranking: 0.5 floor, then year/recency, popularity, and an uncertainty flag. */
export function rankCandidates(
  query: string,
  candidates: readonly (MovieDto | CandidateMovie)[],
  hints: LookupHints,
  options: { floor?: number } = {},
): RankedPick | null {
  const floor = options.floor ?? RELAXED_MATCH_MIN_SCORE;
  const scored = candidates
    .map((movie) => ({ movie: toCandidate(movie), score: calculateSearchScore(query, movie.title) }))
    .filter((item) => item.score >= floor);
  if (scored.length === 0) return null;

  const bestScore = Math.max(...scored.map((item) => item.score));
  let finalists = scored.filter((item) => item.score >= bestScore - 0.1);

  if (hints.wantsNew) {
    // Recency only among near-best scores; future release dates are ignored locally.
    const today = new Date().toISOString().slice(0, 10);
    const notFuture = finalists.filter(
      (item) => item.movie.releaseDate.length >= 4 && item.movie.releaseDate.slice(0, 10) <= today,
    );
    if (notFuture.length > 0) {
      const newest = notFuture.reduce((a, b) =>
        b.movie.releaseDate > a.movie.releaseDate ? b : a,
      ).movie.releaseDate.slice(0, 10);
      finalists = notFuture.filter((item) => item.movie.releaseDate.slice(0, 10) === newest);
    }
  } else if (hints.year !== null) {
    const withYear = finalists.filter(
      (item) => item.movie.releaseDate.slice(0, 4) === String(hints.year),
    );
    if (withYear.length > 0) finalists = withYear;
  }

  const topPopularity = Math.max(...finalists.map((item) => item.movie.popularityScore));
  finalists = finalists.filter((item) => item.movie.popularityScore === topPopularity);

  const ordered = [...finalists].sort(
    (a, b) =>
      b.score - a.score ||
      b.movie.releaseDate.localeCompare(a.movie.releaseDate) ||
      a.movie.id - b.movie.id,
  );
  const best = ordered[0];
  const uncertain =
    ordered.length > 1 && Math.abs(ordered[0].score - ordered[1].score) <= 0.05;
  return { movie: best.movie, score: best.score, uncertain };
}

export type PoolListReader = () => Promise<{ movies: readonly (MovieDto | CandidateMovie)[] }>;

export function defaultPoolReaders(): PoolListReader[] {
  const lists: readonly RankingListName[] = ['popular', 'topRated'];
  return [getNowPlayingMovies, ...lists.map((name) => () => getRankingMovieList(name))];
}

/**
 * Search results arrive as plain DTOs. Reuse the same cached lists to recover internal
 * popularity/vote signals by TMDB id, so a multi-result search can use the same tie-break.
 * Strong intent only; one call per list at most.
 */
export async function enrichWithPoolSignals(
  candidates: readonly MovieDto[],
  readers: readonly PoolListReader[] = defaultPoolReaders(),
): Promise<CandidateMovie[]> {
  if (candidates.length < 2) return candidates.map(toCandidate);
  const signals = new Map<number, CandidateMovie>();
  for (const read of readers) {
    try {
      const list = await read();
      if (!list || !Array.isArray(list.movies)) continue;
      for (const movie of list.movies) {
        const enriched = toCandidate(movie);
        if (enriched.popularityScore > 0 || enriched.voteCount > 0) {
          signals.set(enriched.id, enriched);
        }
      }
    } catch {
      // Signals are best-effort; plain DTOs still rank with zero values.
    }
  }
  return candidates.map((movie) => signals.get(movie.id) ?? toCandidate(movie));
}

/**
 * Last-resort candidate pool for strong intent only: each list is read at most once.
 * Readers are injectable; failed or empty lists are skipped silently.
 */
export async function findPooledMovie(
  query: string,
  intent: 'strong' | 'weak',
  hints: LookupHints,
  readers: readonly PoolListReader[] = defaultPoolReaders(),
): Promise<RankedPick | null> {
  if (intent !== 'strong') return null;
  const candidates: (MovieDto | CandidateMovie)[] = [];
  const seen = new Set<number>();
  for (const read of readers) {
    try {
      const list = await read();
      if (!list || !Array.isArray(list.movies)) continue;
      for (const movie of list.movies) {
        if (!seen.has(movie.id)) {
          seen.add(movie.id);
          candidates.push(movie);
        }
      }
    } catch {
      // One failed list must not block the others; no user text in this path.
    }
  }
  return rankCandidates(query, candidates, hints);
}

/**
 * Final strong-intent step: one title correction, one TMDB search, local ranking at the
 * same 0.5 floor. The corrected title is used only for search and never in logs or replies.
 */
export async function findCorrectedMovie(
  query: string,
  hints: LookupHints,
): Promise<RankedPick | null> {
  if (query.length < 3) return null;
  const correctedTitle = await correctMovieTitle(query, 'assistant');
  if (!correctedTitle) return null;
  try {
    const hits = await searchTmdbMovies(correctedTitle);
    if (!Array.isArray(hits) || hits.length === 0) return null;
    return rankCandidates(correctedTitle, hits, hints, { floor: RELAXED_MATCH_MIN_SCORE });
  } catch {
    return null;
  }
}
