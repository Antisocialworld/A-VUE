import crypto from 'node:crypto';
import { env } from '../env.js';
import { MovieDto, MoviesSearchResponse } from '../schemas/movies.js';
import {
  getCachedJson,
  getNowPlayingMovies,
  searchTmdbMovies,
  setCachedJson,
  singleFlight,
} from './tmdb.js';

/**
 * Named threshold constant for minimum relevance score.
 * Results below this score are dropped.
 */
export const MIN_SEARCH_SCORE = 0.35;

const STALE_SEARCH_TTL_SECONDS = 604800; // 7 days stale fallback

/**
 * Set of common English filler/stop words ignored when scoring,
 * unless the query is made only of filler words.
 */
export const FILLER_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'in',
  'on',
  'at',
  'to',
  'for',
]);

/**
 * Normalises search text:
 * - Strips diacritics via NFD decomposition
 * - Lowercases
 * - Strips punctuation and hyphens (replaces with spaces) per AGENTS.md
 * - Trims
 * - Collapses consecutive whitespace to a single space
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Calculates in-house Damerau-Levenshtein distance between strings a and b.
 * Supports insertions, deletions, substitutions, and transpositions of adjacent characters.
 * Zero external dependencies.
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const d: number[][] = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i++) d[i][0] = i;
  for (let j = 0; j <= lenB; j++) d[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );

      // Transposition of adjacent characters
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[lenA][lenB];
}

/**
 * Calculates typo-tolerant relevance score between query and candidate title.
 * Combines token-wise Damerau-Levenshtein similarity with prefix boost:
 * - Exact full match: 1.0
 * - Exact full prefix match: 0.92 - 1.0 (exact & prefix beat typos)
 * - Token-wise prefix match: 0.88 - 0.98
 * - Token-wise typo (Damerau-Levenshtein): scaled up to 0.85 max so prefix always wins
 */
export function calculateSearchScore(query: string, candidateTitle: string): number {
  const normQ = normalizeSearchText(query);
  const normT = normalizeSearchText(candidateTitle);

  if (!normQ || !normT) return 0;

  // 1. Full exact normalised title match must always rank first (Task 6a)
  if (normQ === normT) return 1.0;

  const allQTokens = normQ.split(' ').filter((t) => t.length > 0);
  const allTTokens = normT.split(' ').filter((t) => t.length > 0);

  if (allQTokens.length === 0 || allTTokens.length === 0) return 0;

  // 2. Ignore filler words when scoring, unless query is made only of filler words (Task 6c)
  const sigQTokens = allQTokens.filter((t) => !FILLER_WORDS.has(t));
  const tokensToScore = sigQTokens.length > 0 ? sigQTokens : allQTokens;

  // 3. A title must match at least half of the query's significant tokens to be kept (Task 6d)
  let matchedSignificantTokens = 0;
  let totalTokenScore = 0;

  for (const qt of tokensToScore) {
    let bestTokenScore = 0;
    for (const tt of allTTokens) {
      let score = 0;
      if (qt === tt) {
        score = 1.0;
      } else if (tt.startsWith(qt)) {
        // Prefix boost on token (e.g. 'resi' matching 'resident')
        score = 0.88 + 0.10 * (qt.length / tt.length);
      } else if (tt.includes(qt)) {
        score = 0.80 + 0.10 * (qt.length / tt.length);
      } else {
        const dist = damerauLevenshteinDistance(qt, tt);
        const maxLen = Math.max(qt.length, tt.length);
        const sim = Math.max(0, 1 - dist / maxLen);
        // Capped so typo never beats an exact prefix
        score = sim * 0.85;
      }
      if (score > bestTokenScore) {
        bestTokenScore = score;
      }
    }

    if (bestTokenScore >= 0.5) {
      matchedSignificantTokens++;
    }
    totalTokenScore += bestTokenScore;
  }

  const requiredMatches = Math.ceil(tokensToScore.length / 2);
  if (matchedSignificantTokens < requiredMatches) {
    return 0;
  }

  const tokenAvg = totalTokenScore / tokensToScore.length;

  // 4. Among matches, penalise extra title tokens so shorter, closer titles rank above longer ones (Task 6b)
  const extraTokens = Math.max(0, allTTokens.length - allQTokens.length);
  const brevityMultiplier = 1 / (1 + 0.08 * extraTokens);
  const penalizedTokenScore = tokenAvg * brevityMultiplier;

  // Full string Damerau-Levenshtein similarity
  const fullDist = damerauLevenshteinDistance(normQ, normT);
  const fullMax = Math.max(normQ.length, normT.length);
  const fullSim = Math.max(0, 1 - fullDist / fullMax) * 0.85 * brevityMultiplier;

  // Prefix & substring match
  let prefixScore = 0;
  if (normT.startsWith(normQ)) {
    prefixScore = (0.92 + 0.06 * (normQ.length / normT.length)) * brevityMultiplier;
  }

  let substringScore = 0;
  if (normT.includes(normQ)) {
    substringScore = (0.85 + 0.05 * (normQ.length / normT.length)) * brevityMultiplier;
  }

  // Exact match alone gets 1.0; all non-exact matches capped below 0.99
  const combinedScore = Math.max(penalizedTokenScore, fullSim, prefixScore, substringScore);
  return Math.min(0.99, combinedScore);
}

/**
 * Searches movies with typo-tolerant fuzzy ranking:
 * 1. Checks Redis cache using SHA-256 hash of normalised query text.
 * 2. Single-flight upstream query deduplication.
 * 3. TMDB search via tmdb adapter.
 * 4. Merges cached now-playing titles if TMDB returns fewer than 5 candidates.
 * 5. In-house token-wise Damerau-Levenshtein ranking with prefix boost.
 * 6. Drops results below MIN_SEARCH_SCORE, caps at 20 results.
 * 7. Falls back to stale Redis copy on upstream failure.
 *
 * Privacy rule: Search query text is NEVER logged, printed, or included in any error.
 */
export async function searchMovies(normalizedQ: string): Promise<MoviesSearchResponse> {
  // ONE newly approved use of SHA-256 for Redis cache key (hex digest)
  const hash = crypto.createHash('sha256').update(normalizedQ).digest('hex');
  const freshKey = `search:${hash}`;
  const staleKey = `search:${hash}:stale`;

  // 1. Check fresh cache
  const cachedFresh = await getCachedJson<MoviesSearchResponse>(freshKey);
  if (cachedFresh) {
    return { ...cachedFresh, stale: false };
  }

  // 2. Single-flight upstream fetch & ranking
  return singleFlight(freshKey, async () => {
    // Re-check fresh cache inside single-flight block
    const recheck = await getCachedJson<MoviesSearchResponse>(freshKey);
    if (recheck) {
      return { ...recheck, stale: false };
    }

    try {
      // 3. Upstream TMDB search
      const tmdbCandidates = await searchTmdbMovies(normalizedQ);

      const candidateMap = new Map<number, { movie: MovieDto; score: number }>();
      for (const m of tmdbCandidates) {
        const score = calculateSearchScore(normalizedQ, m.title);
        candidateMap.set(m.id, { movie: m, score });
      }

      // 4. If fewer than 5 candidates, merge server's cached now-playing titles
      if (candidateMap.size < 5) {
        try {
          const nowPlaying = await getNowPlayingMovies(1);
          for (const m of nowPlaying.movies) {
            const score = calculateSearchScore(normalizedQ, m.title);
            const existing = candidateMap.get(m.id);
            if (!existing) {
              candidateMap.set(m.id, { movie: m, score });
            } else if (score > existing.score) {
              existing.score = score;
            }
          }
        } catch {
          // Non-fatal if now playing cannot be fetched
        }
      }

      // 5. Filter by minimum score and sort descending by score
      const rankedMovies = Array.from(candidateMap.values())
        .filter((item) => item.score >= MIN_SEARCH_SCORE)
        .sort((a, b) => {
          // Exact normalised title match always first (Task 6a)
          const aExact = normalizeSearchText(a.movie.title) === normalizedQ;
          const bExact = normalizeSearchText(b.movie.title) === normalizedQ;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;

          if (Math.abs(b.score - a.score) > 0.0001) {
            return b.score - a.score;
          }
          return (b.movie.voteAverage || 0) - (a.movie.voteAverage || 0);
        })
        .slice(0, 20)
        .map((item) => item.movie);

      const result: MoviesSearchResponse = {
        movies: rankedMovies,
        totalResults: rankedMovies.length,
        stale: false,
      };

      // 6. Cache fresh copy and stale copy in Redis
      await setCachedJson(freshKey, result, env.SEARCH_CACHE_TTL_SECONDS);
      await setCachedJson(staleKey, result, STALE_SEARCH_TTL_SECONDS);

      return result;
    } catch (upstreamErr: any) {
      process.stderr.write(
        '[Search Warning] Upstream search failed. Serving stale copy if present.\n',
      );

      // Fall back to stale copy (7 days TTL)
      const cachedStale = await getCachedJson<MoviesSearchResponse>(staleKey);
      if (cachedStale) {
        return { ...cachedStale, stale: true };
      }

      // No stale copy: throw error so route handler serves 503 error envelope
      throw new Error('SEARCH_UNAVAILABLE');
    }
  });
}
