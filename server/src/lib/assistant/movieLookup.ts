import type { MovieDto } from '../../schemas/movies.js';
import { normalizeSearchText } from '../search.js';

export const MOVIE_FOUND_TEXT = 'Here is what I found.';
export const MOVIE_NOT_FOUND_TEXT = "I couldn't find that movie. Try the Search screen in A VUE.";
export const MOVIE_UNAVAILABLE_TEXT = 'Movie details are unavailable right now. Try again shortly.';
export const WEAK_MATCH_MIN_SCORE = 0.85;

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
