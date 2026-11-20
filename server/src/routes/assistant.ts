import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { assistantRateLimit } from '../lib/rateLimit.js';
import { getSessionUser, UnauthorizedError } from '../lib/session.js';
import { buildSystemPrompt } from '../lib/assistant/systemPrompt.js';
import {
  generate,
  isRetryableServerError,
  AssistantGenerationError,
  AssistantNotConfiguredError,
  AssistantRateLimitedError,
  assistantErrorCategory,
  type AssistantErrorCategory,
} from '../lib/assistant/model.js';
import { checkScope, normaliseBrand, SCOPE_REFUSAL_TEXT } from '../lib/assistant/scopeGuard.js';
import { GREETING_TEXT, isGreeting } from '../lib/assistant/greeting.js';
import {
  checkFacts,
  classifyFactsIntent,
  FACTS_REFUSAL_PRICE_TEXT,
  FACTS_REFUSAL_SHOWTIMES_TEXT,
  factsRefusalText,
  LIVE_PRICE_LINE_TEXT,
  LIVE_PRICE_RANGE_LINE_TEXT,
  LIVE_SHOWTIMES_LINE_TEXT,
  LIVE_SHOWTIMES_TITLE_TEXT,
  LIVE_SHOWTIMES_TODAY_TEXT,
  LIVE_SHOWTIMES_TOMORROW_TEXT,
} from '../lib/assistant/factsGate.js';
import {
  formatKoboToNaira,
  readCinemaPriceRanges,
  readUpcomingShowtimes,
  type CinemaPriceRange,
  type CinemaShowtime,
} from '../lib/assistant/liveFacts.js';
import { calculateSearchScore, normalizeSearchText, searchMovies } from '../lib/search.js';
import {
  MOVIE_FOUND_TEXT,
  MOVIE_NOT_FOUND_TEXT,
  MOVIE_UNAVAILABLE_TEXT,
  MOVIE_YEAR_HINT_TEXT,
  RELAXED_MATCH_MIN_SCORE,
  WEAK_MATCH_MIN_SCORE,
  buildLookupQuery,
  detectMovieIntent,
  enrichWithPoolSignals,
  extractLookupHints,
  extractMovieTitle,
  findCachedMovie,
  findCorrectedMovie,
  findPooledMovie,
  findRelaxedMovie,
  isSearchableMovieTitle,
  rankCandidates,
  toMovieSummary,
  type MovieLookupStage,
} from '../lib/assistant/movieLookup.js';

// Friendly 429 copy, shared by every rate-limit response on this route.
const ASSISTANT_BUSY_MESSAGE = 'Ask A VUE is busy right now. Try again shortly.';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(600),
});

const assistantChatBodySchema = z.object({
  message: z.string().trim().min(1).max(300),
  history: z.array(historyItemSchema).max(4).optional(),
});

function getTodayLagos(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function getLagosDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function dayLabel(dateKey: string, today: string, tomorrow: string): string {
  if (dateKey === today) return LIVE_SHOWTIMES_TODAY_TEXT;
  if (dateKey === tomorrow) return LIVE_SHOWTIMES_TOMORROW_TEXT;
  return dateKey;
}

/** Fills only the fixed placeholders in a text constant; values come from the database. */
function fillLiveTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(cinema|price|low|high|times|title)\}/g, (token) => {
    return values[token.slice(1, -1)] ?? token;
  });
}

function buildPriceReply(ranges: readonly CinemaPriceRange[]): string {
  return ranges
    .map((range) => {
      const low = formatKoboToNaira(range.lowKobo);
      const high = formatKoboToNaira(range.highKobo);
      if (!low || !high) return '';
      return low === high
        ? fillLiveTemplate(LIVE_PRICE_LINE_TEXT, { cinema: range.cinemaName, price: low })
        : fillLiveTemplate(LIVE_PRICE_RANGE_LINE_TEXT, {
            cinema: range.cinemaName,
            low,
            high,
          });
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

function buildShowtimesReply(title: string, rows: readonly CinemaShowtime[]): string {
  const today = getLagosDateKey();
  const tomorrow = nextDateKey(today);
  const byDay = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    const byCinema = byDay.get(row.showDate) ?? new Map<string, string[]>();
    const times = byCinema.get(row.cinemaName) ?? [];
    times.push(row.time);
    byCinema.set(row.cinemaName, times);
    byDay.set(row.showDate, byCinema);
  }

  const lines = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, byCinema]) => [
      dayLabel(date, today, tomorrow),
      ...[...byCinema.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cinema, times]) =>
          fillLiveTemplate(LIVE_SHOWTIMES_LINE_TEXT, {
            cinema,
            times: times.slice().sort().join(', '),
          }),
        ),
    ]);
  if (lines.length === 0) return '';
  return [fillLiveTemplate(LIVE_SHOWTIMES_TITLE_TEXT, { title }), ...lines].join('\n');
}

const SHOWTIME_QUERY_STRIP_RE =
  /\b(?:what|times?|show\s*times?|showings?|screenings?|start\s+times?|starts?|at|is|are|for|on|playing|showing|today|tomorrow|the|a|an|please)\b/gi;

/** Uses the existing title extractor after removing closed-set showtime phrasing. */
function extractShowtimeTitle(message: string): string | null {
  const direct = extractMovieTitle(message);
  if (direct) return direct;
  const stripped = message.replace(SHOWTIME_QUERY_STRIP_RE, ' ').replace(/\s+/g, ' ').trim();
  return stripped ? extractMovieTitle(`poster ${stripped}`) : null;
}

interface ShowtimeMovieMatch {
  id: number;
  title: string;
}

/** Strong-intent movie lookup, reusing the route's existing lookup primitives. */
async function resolveShowtimeMovieId(message: string): Promise<ShowtimeMovieMatch | null> {
  const title = extractShowtimeTitle(message);
  if (!title || !isSearchableMovieTitle(title)) return null;
  const hints = extractLookupHints(message, title);
  const query = buildLookupQuery(title, hints);
  const searchResult = await searchMovies(normalizeSearchText(query));
  const candidates = await enrichWithPoolSignals(searchResult.movies);
  const pick = rankCandidates(query, candidates, hints, { floor: RELAXED_MATCH_MIN_SCORE });
  if (pick) return { id: pick.movie.id, title: pick.movie.title };
  const relaxed = await findRelaxedMovie(query, 'strong', (relaxedQuery) =>
    searchMovies(normalizeSearchText(relaxedQuery)),
  );
  if (relaxed) return { id: relaxed.id, title: relaxed.title };
  const cached = await findCachedMovie(query, 'strong');
  if (cached) return { id: cached.id, title: cached.title };
  const pooled = await findPooledMovie(query, 'strong', hints);
  return pooled ? { id: pooled.movie.id, title: pooled.movie.title } : null;
}

export async function assistantRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/assistant/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: request.id,
          },
        });
      }
      throw err;
    }

    const allowed = await assistantRateLimit(request, reply, user.id);
    if (!allowed) return;

    const parsed = assistantChatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request. Check your message and try again.',
          requestId: request.id,
        },
      });
    }

    const scope = checkScope(parsed.data.message);
    if (scope.kind === 'other-vue') {
      request.log.info({ verdict: scope.kind }, 'assistant_scope_verdict');
      return reply.status(200).send({ reply: SCOPE_REFUSAL_TEXT });
    }
    request.log.info({ verdict: scope.kind }, 'assistant_scope_verdict');

    if (isGreeting(parsed.data.message)) {
      request.log.info({ verdict: 'greeting' }, 'assistant_greeting_verdict');
      return reply.status(200).send({ reply: GREETING_TEXT });
    }

    const facts = checkFacts(parsed.data.message);
    if (facts.kind === 'needs-facts') {
      const factIntent = classifyFactsIntent(parsed.data.message);

      if (factIntent === 'price') {
        try {
          const replyText = buildPriceReply(await readCinemaPriceRanges());
          if (replyText) {
            request.log.info(
              { verdict: 'live-facts', intent: factIntent, outcome: 'answered' },
              'assistant_live_facts',
            );
            return reply.status(200).send({ reply: replyText });
          }
          request.log.info(
            { verdict: 'live-facts', intent: factIntent, outcome: 'empty' },
            'assistant_live_facts',
          );
        } catch {
          request.log.info(
            { verdict: 'live-facts', intent: factIntent, outcome: 'error' },
            'assistant_live_facts',
          );
        }
        return reply.status(200).send({ reply: FACTS_REFUSAL_PRICE_TEXT });
      }

      if (factIntent === 'showtimes') {
        let outcome: 'answered' | 'empty' | 'error' = 'error';
        try {
          const movie = await resolveShowtimeMovieId(parsed.data.message);
          if (movie !== null) {
            const replyText = buildShowtimesReply(
              movie.title,
              await readUpcomingShowtimes(movie.id),
            );
            if (replyText) {
              request.log.info(
                { verdict: 'live-facts', intent: factIntent, outcome: 'answered' },
                'assistant_live_facts',
              );
              return reply.status(200).send({ reply: replyText });
            }
          }
          outcome = 'empty';
        } catch {
          outcome = 'error';
        }
        request.log.info(
          { verdict: 'live-facts', intent: factIntent, outcome },
          'assistant_live_facts',
        );
        return reply.status(200).send({ reply: FACTS_REFUSAL_SHOWTIMES_TEXT });
      }
    }
    request.log.info({ verdict: facts.kind }, 'assistant_facts_verdict');
    if (facts.kind === 'needs-facts') {
      return reply.status(200).send({ reply: factsRefusalText(parsed.data.message) });
    }

    const intent = detectMovieIntent(parsed.data.message);
    if (intent !== 'none') {
      const title = extractMovieTitle(parsed.data.message);
      if (title && isSearchableMovieTitle(title)) {
        const hints = extractLookupHints(parsed.data.message, title);
        const query = buildLookupQuery(title, hints);
        const movieLookupStartedAt = Date.now();
        // stage is a closed set from movieLookup.ts; never include titles, queries or user text.
        const logMovieLookup = (
          verdict: 'movie-match' | 'movie-none' | 'movie-error',
          stage: MovieLookupStage,
        ) => {
          request.log.info(
            { verdict, stage, latencyMs: Date.now() - movieLookupStartedAt },
            'assistant_movie_lookup',
          );
        };
        let stage: MovieLookupStage = 'none';
        let uncertain = false;

        try {
          const searchResult = await searchMovies(normalizeSearchText(query));
          let match: (typeof searchResult.movies)[number] | null = null;
          if (intent === 'strong') {
            // One candidate keeps the old first-hit behaviour; ties use local ranking.
            const candidates = await enrichWithPoolSignals(searchResult.movies);
            const pick = rankCandidates(query, candidates, hints, { floor: 0 });
            match = pick?.movie ?? null;
            uncertain = pick?.uncertain ?? false;
          } else {
            const movie = searchResult.movies[0];
            if (movie && calculateSearchScore(query, movie.title) >= WEAK_MATCH_MIN_SCORE) {
              match = movie;
            }
          }
          if (match) stage = 'search';
          if (!match) {
            match = await findRelaxedMovie(query, intent, (relaxedQuery) =>
              searchMovies(normalizeSearchText(relaxedQuery)),
            );
            if (match) stage = 'relaxed';
          }
          if (!match) {
            // Last list step is local only: score against the cached Movies screen list.
            match = await findCachedMovie(query, intent);
            if (match) stage = 'cached';
          }
          if (!match && intent === 'strong') {
            const pick = await findPooledMovie(query, intent, hints);
            if (pick) {
              match = pick.movie;
              uncertain = pick.uncertain;
              stage = 'pool';
            }
          }
          if (!match && intent === 'strong') {
            const pick = await findCorrectedMovie(query, hints);
            if (pick) {
              match = pick.movie;
              uncertain = pick.uncertain;
              stage = 'corrected';
            }
          }
          if (match) {
            logMovieLookup('movie-match', stage);
            return reply.status(200).send({
              reply: uncertain ? `${MOVIE_FOUND_TEXT} ${MOVIE_YEAR_HINT_TEXT}` : MOVIE_FOUND_TEXT,
              movie: toMovieSummary(match),
            });
          }
          logMovieLookup('movie-none', 'none');
          if (intent === 'strong') {
            return reply.status(200).send({ reply: MOVIE_NOT_FOUND_TEXT });
          }
        } catch {
          logMovieLookup('movie-error', 'none');
          if (intent === 'strong') {
            return reply.status(200).send({ reply: MOVIE_UNAVAILABLE_TEXT });
          }
        }
      }
    }

    if (!env.GEMINI_API_KEY || !env.GEMINI_CHAT_MODEL) {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Ask A VUE is not available right now. Please try again later.',
          requestId: request.id,
        },
      });
    }

    const todayLagos = getTodayLagos();
    const system = buildSystemPrompt(todayLagos);
    const history = (parsed.data.history ?? []).map((h) => ({
      role: h.role,
      text: h.role === 'user' ? normaliseBrand(h.text) : h.text,
    }));
    const normalisedMessage = normaliseBrand(parsed.data.message);

    const primaryModel = env.GEMINI_CHAT_MODEL!;
    const fallbackModel = env.GEMINI_FALLBACK_MODEL?.trim() || undefined;
    const timeoutMs = env.GEMINI_ATTEMPT_TIMEOUT_MS;
    // Route-level budget for two attempts. generate() clamps each attempt to >=10000 ms,
    // so worst case is 15 s primary + 10 s fallback = 25 s, inside the app's 27 s deadline.
    const totalAttemptBudgetMs = 24000;

    // One line per generate attempt: attempt, model, outcome, latencyMs, and status only on failure.
    // No message text, history, API key or raw provider body is ever logged.
    const logAttempt = (meta: {
      attempt: 'primary' | 'fallback';
      model: string;
      outcome: 'ok' | 'failed';
      statusCode?: number;
      finishReason?: string;
      category?: AssistantErrorCategory;
      latencyMs?: number;
    }) => {
      const fields: Record<string, unknown> = {
        attempt: meta.attempt,
        model: meta.model,
        outcome: meta.outcome,
        latencyMs: meta.latencyMs,
      };
      if (meta.outcome === 'failed') {
        fields.statusCode = meta.statusCode;
        fields.finishReason = meta.finishReason;
        fields.category = meta.category;
      }
      if (meta.outcome === 'ok') {
        request.log.info(fields, 'assistant_generate_ok');
      } else {
        request.log.warn(fields, 'assistant_generate_failed');
      }
    };

    const failureMeta = (
      err: unknown,
      attempt: 'primary' | 'fallback',
      model: string,
      startedAt: number,
    ) => {
      const generationErr = err instanceof AssistantGenerationError ? err : undefined;
      const rawStatus = (err as { status?: unknown } | null | undefined)?.status;
      const finishReason = generationErr?.finishReason;
      return {
        attempt,
        model,
        outcome: 'failed' as const,
        category: assistantErrorCategory(err, finishReason),
        statusCode:
          generationErr?.status ??
          (err instanceof AssistantNotConfiguredError
            ? 503
            : typeof rawStatus === 'number'
              ? rawStatus
              : undefined),
        finishReason,
        latencyMs: generationErr?.latencyMs ?? Date.now() - startedAt,
      };
    };

    const toGenerationResponse = (err: unknown) => {
      if (err instanceof AssistantRateLimitedError) {
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: ASSISTANT_BUSY_MESSAGE,
            requestId: request.id,
          },
        });
      }
      if (err instanceof AssistantNotConfiguredError) {
        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Ask A VUE is not available right now. Please try again later.',
            requestId: request.id,
          },
        });
      }
      if (err instanceof AssistantGenerationError) {
        return reply.status(502).send({
          error: {
            code: 'BAD_GATEWAY',
            message: 'Ask A VUE could not respond right now. Please try again.',
            requestId: request.id,
          },
        });
      }
      return reply.status(502).send({
        error: {
          code: 'BAD_GATEWAY',
          message: 'Ask A VUE could not respond right now. Please try again.',
          requestId: request.id,
        },
      });
    };

    const primaryStartedAt = Date.now();
    try {
      const replyText = await generate({
        system,
        history,
        message: normalisedMessage,
        model: primaryModel,
        timeoutMs,
        attempt: 'primary',
      });
      logAttempt({
        attempt: 'primary',
        model: primaryModel,
        outcome: 'ok',
        latencyMs: Date.now() - primaryStartedAt,
      });
      return reply.status(200).send({ reply: replyText });
    } catch (err: any) {
      logAttempt(failureMeta(err, 'primary', primaryModel, primaryStartedAt));
      if (err instanceof AssistantNotConfiguredError) {
        return toGenerationResponse(err);
      }

      // Our own limiter's 429 returns above before generate(). A 429 from Gemini is
      // retryable here with the same single fallback and configured per-attempt deadline.
      if (!fallbackModel || !isRetryableServerError(err)) {
        return toGenerationResponse(err);
      }

      const fallbackStartedAt = Date.now();
      const fallbackTimeoutMs = Math.min(
        timeoutMs,
        Math.max(2000, totalAttemptBudgetMs - (fallbackStartedAt - primaryStartedAt)),
      );
      try {
        const fallbackReply = await generate({
          system,
          history,
          message: normalisedMessage,
          model: fallbackModel,
          timeoutMs: fallbackTimeoutMs,
          attempt: 'fallback',
        });
        logAttempt({
          attempt: 'fallback',
          model: fallbackModel,
          outcome: 'ok',
          latencyMs: Date.now() - fallbackStartedAt,
        });
        return reply.status(200).send({ reply: fallbackReply });
      } catch (fallbackErr: any) {
        logAttempt(failureMeta(fallbackErr, 'fallback', fallbackModel, fallbackStartedAt));
        return toGenerationResponse(fallbackErr);
      }
    }
  });
}
