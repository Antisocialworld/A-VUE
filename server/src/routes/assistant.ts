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
} from '../lib/assistant/model.js';
import { checkScope, normaliseBrand, SCOPE_REFUSAL_TEXT } from '../lib/assistant/scopeGuard.js';
import { checkFacts, FACTS_REFUSAL_TEXT } from '../lib/assistant/factsGate.js';
import { calculateSearchScore, normalizeSearchText, searchMovies } from '../lib/search.js';
import {
  MOVIE_FOUND_TEXT,
  MOVIE_NOT_FOUND_TEXT,
  MOVIE_UNAVAILABLE_TEXT,
  WEAK_MATCH_MIN_SCORE,
  detectMovieIntent,
  extractMovieTitle,
  isSearchableMovieTitle,
  toMovieSummary,
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

    const facts = checkFacts(parsed.data.message);
    request.log.info({ verdict: facts.kind }, 'assistant_facts_verdict');
    if (facts.kind === 'needs-facts') {
      return reply.status(200).send({ reply: FACTS_REFUSAL_TEXT });
    }

    const intent = detectMovieIntent(parsed.data.message);
    if (intent !== 'none') {
      const title = extractMovieTitle(parsed.data.message);
      if (title && isSearchableMovieTitle(title)) {
        const movieLookupStartedAt = Date.now();
        const logMovieLookup = (verdict: 'movie-match' | 'movie-none' | 'movie-error') => {
          request.log.info(
            { verdict, latencyMs: Date.now() - movieLookupStartedAt },
            'assistant_movie_lookup',
          );
        };

        try {
          const searchResult = await searchMovies(normalizeSearchText(title));
          const movie = searchResult.movies[0];
          if (
            movie &&
            (intent === 'strong' ||
              calculateSearchScore(title, movie.title) >= WEAK_MATCH_MIN_SCORE)
          ) {
            logMovieLookup('movie-match');
            return reply.status(200).send({
              reply: MOVIE_FOUND_TEXT,
              movie: toMovieSummary(movie),
            });
          }
          logMovieLookup('movie-none');
          if (intent === 'strong') {
            return reply.status(200).send({ reply: MOVIE_NOT_FOUND_TEXT });
          }
        } catch {
          logMovieLookup('movie-error');
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
    // Two attempts must finish inside the app's 25 s client deadline, even when the
    // configured per-attempt value is at its 15000 ms maximum.
    const totalAttemptBudgetMs = 24000;

    // One line per generate attempt: attempt, model, outcome, latencyMs, and status only on failure.
    // No message text, history, API key or raw provider body is ever logged.
    const logAttempt = (meta: {
      attempt: 'primary' | 'fallback';
      model: string;
      outcome: 'ok' | 'failed';
      statusCode?: number;
      finishReason?: string;
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
      return {
        attempt,
        model,
        outcome: 'failed' as const,
        statusCode:
          generationErr?.status ??
          (err instanceof AssistantNotConfiguredError
            ? 503
            : typeof rawStatus === 'number'
              ? rawStatus
              : undefined),
        finishReason: generationErr?.finishReason,
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
