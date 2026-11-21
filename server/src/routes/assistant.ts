import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { assistantRateLimit } from '../lib/rateLimit.js';
import { getSessionUser, UnauthorizedError } from '../lib/session.js';
import {
  ASSISTANT_DEADLINE_REPLY,
  buildSystemPrompt,
} from '../lib/assistant/systemPrompt.js';
import {
  ASSISTANT_REQUEST_DEADLINE_MS,
  MIN_MODEL_BUDGET_MS,
} from '../lib/assistant/deadline.js';
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
import { isToolEligibleMessage, runAssistantToolFlow } from '../lib/assistant/toolUse.js';
import {
  logRagRetrieval,
  retrieveFactChunks,
  withRagFactContext,
} from '../lib/rag/retrieve.js';
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

const ASSISTANT_DEADLINE_PATHS = [
  'setup',
  'scope',
  'greeting',
  'facts',
  'live-facts',
  'movie-card',
  'tool',
  'retrieval',
  'generate',
] as const;
type AssistantDeadlinePath = (typeof ASSISTANT_DEADLINE_PATHS)[number];

function remainingRequestMs(startedAt: number): number {
  return Math.max(0, ASSISTANT_REQUEST_DEADLINE_MS - (Date.now() - startedAt));
}

/** null means the model must not be started: no useful time left in the request budget. */
function modelAttemptBudgetMs(configuredMs: number, startedAt: number): number | null {
  const remaining = remainingRequestMs(startedAt);
  if (remaining < MIN_MODEL_BUDGET_MS) return null;
  return Math.min(configuredMs, remaining);
}

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
    const requestStartedAt = Date.now();
    const requestController = new AbortController();
    const signal = requestController.signal;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineLogged = false;
    let currentPath: AssistantDeadlinePath = 'setup';

    const deadlinePromise = new Promise<'deadline'>((resolve) => {
      deadlineTimer = setTimeout(() => {
        requestController.abort();
        resolve('deadline');
      }, ASSISTANT_REQUEST_DEADLINE_MS);
    });

    const logDeadlineOnce = (path: AssistantDeadlinePath): void => {
      if (deadlineLogged) return;
      deadlineLogged = true;
      request.log.info({ verdict: 'assistant-deadline', path });
    };

    /** No helper that ignores its signal may write a second response after expiry. */
    const sendIfActive = (statusCode: number, body: unknown) => {
      if (signal.aborted || reply.sent) return;
      reply.status(statusCode).send(body);
    };
    const sendDeadlineReply = (): void => {
      if (reply.sent) return;
      reply.status(200).send({ reply: ASSISTANT_DEADLINE_REPLY });
    };

    const runRequest = async (): Promise<void> => {
    const logVerdict = (fields: unknown, msg: string): void => {
      if (!signal.aborted) request.log.info(fields, msg);
    };
    const logWarn = (fields: unknown, msg: string): void => {
      if (!signal.aborted) request.log.warn(fields, msg);
    };
    const skipForBudget = (): void => {
      logDeadlineOnce(currentPath);
      sendIfActive(200, { reply: ASSISTANT_DEADLINE_REPLY });
    };

    let user;
    try {
      user = await getSessionUser(request);
    } catch (err: any) {
      if (err instanceof UnauthorizedError || err?.name === 'UnauthorizedError' || err?.message === 'Unauthorized') {
        return sendIfActive(401, {
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
      return sendIfActive(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request. Check your message and try again.',
          requestId: request.id,
        },
      });
    }

    currentPath = 'scope';
    const scope = checkScope(parsed.data.message);
    if (scope.kind === 'other-vue') {
      logVerdict({ verdict: scope.kind }, 'assistant_scope_verdict');
      return sendIfActive(200, { reply: SCOPE_REFUSAL_TEXT });
    }
    logVerdict({ verdict: scope.kind }, 'assistant_scope_verdict');

    currentPath = 'greeting';
    if (isGreeting(parsed.data.message)) {
      logVerdict({ verdict: 'greeting' }, 'assistant_greeting_verdict');
      return sendIfActive(200, { reply: GREETING_TEXT });
    }

    currentPath = 'facts';
    const facts = checkFacts(parsed.data.message);
    if (facts.kind === 'needs-facts') {
      const factIntent = classifyFactsIntent(parsed.data.message);

      if (factIntent === 'price') {
        currentPath = 'live-facts';
        if (signal.aborted) return;
        if (remainingRequestMs(requestStartedAt) < MIN_MODEL_BUDGET_MS) {
          skipForBudget();
          return;
        }
        try {
          const replyText = buildPriceReply(await readCinemaPriceRanges());
          if (replyText) {
            logVerdict(
              { verdict: 'live-facts', intent: factIntent, outcome: 'answered' },
              'assistant_live_facts',
            );
            return sendIfActive(200, { reply: replyText });
          }
          logVerdict(
            { verdict: 'live-facts', intent: factIntent, outcome: 'empty' },
            'assistant_live_facts',
          );
        } catch {
          logVerdict(
            { verdict: 'live-facts', intent: factIntent, outcome: 'error' },
            'assistant_live_facts',
          );
        }
        return sendIfActive(200, { reply: FACTS_REFUSAL_PRICE_TEXT });
      }

      if (factIntent === 'showtimes') {
        currentPath = 'live-facts';
        if (signal.aborted) return;
        if (remainingRequestMs(requestStartedAt) < MIN_MODEL_BUDGET_MS) {
          skipForBudget();
          return;
        }
        let outcome: 'answered' | 'empty' | 'error' = 'error';
        try {
          const movie = await resolveShowtimeMovieId(parsed.data.message);
          if (movie !== null) {
            const replyText = buildShowtimesReply(
              movie.title,
              await readUpcomingShowtimes(movie.id),
            );
            if (replyText) {
              logVerdict(
                { verdict: 'live-facts', intent: factIntent, outcome: 'answered' },
                'assistant_live_facts',
              );
              return sendIfActive(200, { reply: replyText });
            }
          }
          outcome = 'empty';
        } catch {
          outcome = 'error';
        }
        logVerdict(
          { verdict: 'live-facts', intent: factIntent, outcome },
          'assistant_live_facts',
        );
        return sendIfActive(200, { reply: FACTS_REFUSAL_SHOWTIMES_TEXT });
      }
    }
    logVerdict({ verdict: facts.kind }, 'assistant_facts_verdict');
    if (facts.kind === 'needs-facts') {
      return sendIfActive(200, { reply: factsRefusalText(parsed.data.message) });
    }

    currentPath = 'movie-card';
    const intent = detectMovieIntent(parsed.data.message);
    if (intent !== 'none') {
      const title = extractMovieTitle(parsed.data.message);
      if (title && isSearchableMovieTitle(title)) {
        if (signal.aborted) return;
        if (remainingRequestMs(requestStartedAt) < MIN_MODEL_BUDGET_MS) {
          skipForBudget();
          return;
        }
        const hints = extractLookupHints(parsed.data.message, title);
        const query = buildLookupQuery(title, hints);
        const movieLookupStartedAt = Date.now();
        // stage is a closed set from movieLookup.ts; never include titles, queries or user text.
        const logMovieLookup = (
          verdict: 'movie-match' | 'movie-none' | 'movie-error',
          stage: MovieLookupStage,
        ) => {
          logVerdict(
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
            return sendIfActive(200, {
              reply: uncertain ? `${MOVIE_FOUND_TEXT} ${MOVIE_YEAR_HINT_TEXT}` : MOVIE_FOUND_TEXT,
              movie: toMovieSummary(match),
            });
          }
          logMovieLookup('movie-none', 'none');
          if (intent === 'strong') {
            return sendIfActive(200, { reply: MOVIE_NOT_FOUND_TEXT });
          }
        } catch {
          logMovieLookup('movie-error', 'none');
          if (intent === 'strong') {
            return sendIfActive(200, { reply: MOVIE_UNAVAILABLE_TEXT });
          }
        }
      }
    }

    if (!env.GEMINI_API_KEY || !env.GEMINI_CHAT_MODEL) {
      return sendIfActive(503, {
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
        logVerdict(fields, 'assistant_generate_ok');
      } else {
        logWarn(fields, 'assistant_generate_failed');
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
        return sendIfActive(429, {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: ASSISTANT_BUSY_MESSAGE,
            requestId: request.id,
          },
        });
      }
      if (err instanceof AssistantNotConfiguredError) {
        return sendIfActive(503, {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Ask A VUE is not available right now. Please try again later.',
            requestId: request.id,
          },
        });
      }
      if (err instanceof AssistantGenerationError) {
        return sendIfActive(502, {
          error: {
            code: 'BAD_GATEWAY',
            message: 'Ask A VUE could not respond right now. Please try again.',
            requestId: request.id,
          },
        });
      }
      return sendIfActive(502, {
        error: {
          code: 'BAD_GATEWAY',
          message: 'Ask A VUE could not respond right now. Please try again.',
          requestId: request.id,
        },
      });
    };

    // Final model branch only: tools and RAG are mutually exclusive. RAG is a single
    // fail-open call; retrieved chunks are supplied as data to both generate attempts.
    currentPath = 'retrieval';
    if (signal.aborted) return;
    const toolEligible = isToolEligibleMessage(normalisedMessage);
    const ragChunks = toolEligible ? [] : await retrieveFactChunks(normalisedMessage, signal);
    if (toolEligible) logRagRetrieval('skipped');
    const systemWithFacts = withRagFactContext(system, ragChunks);

    // Bounded TMDB tool round for person/credit questions. Any non-ok outcome falls
    // through to the existing non-tool answer below; tool failures never become 5xx.
    if (toolEligible) {
      currentPath = 'tool';
      if (signal.aborted) return;
      const toolBudgetMs = modelAttemptBudgetMs(timeoutMs, requestStartedAt);
      if (toolBudgetMs === null) {
        skipForBudget();
        return;
      }
      const toolFlowStartedAt = Date.now();
      try {
        const toolResult = await runAssistantToolFlow({
          system,
          history,
          message: normalisedMessage,
          model: primaryModel,
          timeoutMs: toolBudgetMs,
          attempt: 'primary',
        });
        if (toolResult.used && toolResult.text) {
          logAttempt({
            attempt: 'primary',
            model: primaryModel,
            outcome: 'ok',
            latencyMs: Date.now() - toolFlowStartedAt,
          });
          return sendIfActive(200, { reply: toolResult.text });
        }
      } catch {
        // Defensive: the tool flow is total; a tool problem must never surface as 5xx.
      }
    }

    currentPath = 'generate';
    if (signal.aborted) return;
    const primaryBudgetMs = modelAttemptBudgetMs(timeoutMs, requestStartedAt);
    if (primaryBudgetMs === null) {
      skipForBudget();
      return;
    }
    const primaryStartedAt = Date.now();
    try {
      const replyText = await generate({
        system: systemWithFacts,
        history,
        message: normalisedMessage,
        model: primaryModel,
        timeoutMs: primaryBudgetMs,
        attempt: 'primary',
        signal,
      });
      logAttempt({
        attempt: 'primary',
        model: primaryModel,
        outcome: 'ok',
        latencyMs: Date.now() - primaryStartedAt,
      });
      return sendIfActive(200, { reply: replyText });
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

      if (signal.aborted) {
        skipForBudget();
        return;
      }
      const fallbackStartedAt = Date.now();
      const fallbackTimeoutMs = Math.min(
        timeoutMs,
        Math.max(2000, totalAttemptBudgetMs - (fallbackStartedAt - primaryStartedAt)),
      );
      const fallbackBudgetMs = modelAttemptBudgetMs(fallbackTimeoutMs, requestStartedAt);
      if (fallbackBudgetMs === null) {
        skipForBudget();
        return;
      }
      try {
        const fallbackReply = await generate({
          system: systemWithFacts,
          history,
          message: normalisedMessage,
          model: fallbackModel,
          timeoutMs: fallbackBudgetMs,
          attempt: 'fallback',
          signal,
        });
        logAttempt({
          attempt: 'fallback',
          model: fallbackModel,
          outcome: 'ok',
          latencyMs: Date.now() - fallbackStartedAt,
        });
        return sendIfActive(200, { reply: fallbackReply });
      } catch (fallbackErr: any) {
        logAttempt(failureMeta(fallbackErr, 'fallback', fallbackModel, fallbackStartedAt));
        return toGenerationResponse(fallbackErr);
      }
    }
    };

    let requestError: unknown;
    const requestPromise = runRequest()
      .then(() => 'done' as const)
      .catch((err: unknown) => {
        requestError = err;
        return 'failed' as const;
      });

    try {
      const outcome = await Promise.race([requestPromise, deadlinePromise]);
      if (outcome === 'failed') throw requestError;
      if (outcome === 'deadline') {
        logDeadlineOnce(currentPath);
        sendDeadlineReply();
      }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  });
}
