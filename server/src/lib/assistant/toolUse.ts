import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import {
  getCachedJson,
  setCachedJson,
  getTmdbMovieCast,
  getTmdbPersonMovieCredits,
  searchTmdbPeople,
} from '../tmdb.js';
import { searchRateLimit } from '../rateLimit.js';
import {
  generateTurn,
  AssistantTimeoutError,
  type AssistantAttempt,
  type AssistantHistoryItem,
  type AssistantToolCall,
  type AssistantToolDeclaration,
  type AssistantToolResponse,
} from './model.js';

// One bounded tool round, at most two function calls, eight structured items per result.
export const TOOL_NAMES = ['lookup_person', 'lookup_person_filmography', 'lookup_movie_cast'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const MAX_TOOL_CALLS = 2;
export const MAX_RESULT_ITEMS = 8;
const CACHE_TTL_SECONDS = 300;
/**
 * Hard deadline for the whole tool round. It is deliberately below the 10 s floor that
 * generate() applies to every model attempt, so a hung tool round is aborted and the
 * route falls back to the existing non-tool answer instead of waiting on the model.
 */
export const ASSISTANT_TOOL_DEADLINE_MS = 8000;

export const TMDB_TOOL_ATTRIBUTION_TEXT =
  'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.';

type ToolUseOutcome = 'ok' | 'none' | 'invalid' | 'error' | 'skipped';
type LogTool = ToolName | 'none';
type ToolExecutionResult = { found: boolean; response: Record<string, unknown> };
type CachedToolResult = ToolExecutionResult;

export type AssistantToolFlowResult = {
  /** True when the message was eligible and the tool path actually ran. */
  used: boolean;
  outcome: ToolUseOutcome;
  /** Final, attributed answer only when outcome is 'ok' (or a declined tool turn). */
  text?: string;
};

const toolArgsSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
  })
  .strict();

/**
 * Same character rule as isAllowedCorrectionInput, with a 2-character floor so short
 * names such as "Li" can pass. No long digit runs, no '@', no free-form chat text.
 */
export function isValidToolInput(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  if (raw.length < 2 || raw.length > 60) return false;
  if (raw.includes('@')) return false;
  if (/\d{5,}/.test(raw)) return false;
  if ((raw.match(/\d/g) ?? []).length >= 7) return false;
  return !/[^A-Za-z0-9 '\-:.,&]/.test(raw);
}

/**
 * Positive cues are broad on purpose: no film word is ever gated or banned. The only
 * exclusions are messages whose subject is nothing more than a pronoun/demonstrative,
 * because there is then no name to send to the structured lookup adapters.
 */
const PERSON_OR_CREDITS_RE = new RegExp(
  [
    String.raw`who(?:'s|\s+(?:is|was))\b`,
    String.raw`who\s+(?:directed|directs|directing|is\s+directing|starred\s+in|played\s+in|appeared\s+in|is\s+in|was\s+in)\b`,
    String.raw`(?:cast|director)\s+of\b`,
    String.raw`what\s+(?:movies|films)\s+(?:is|was|has)\b`,
    String.raw`what\s+has\s+.+\s+been\s+in\b`,
    String.raw`(?:movies|films)\s+with\b`,
    String.raw`known\s+for\b`,
    String.raw`filmography\b`,
    String.raw`(?:actor|actress|director|filmmaker|producer|screenwriter|credits?)\b`,
  ].join('|'),
  'i',
);

const CUE_PREFIX_RE =
  /^(?:who(?:\s+(?:directed|directs|directing|is\s+directing|starred\s+in|played\s+in|appeared\s+in|is\s+in|was\s+in)|'s|\s+(?:is|was))\s+|(?:cast|director)\s+of\s+|(?:movies|films)\s+with\s+|what\s+(?:movies|films)\s+(?:is|was)\s+|what\s+has\s+)/i;

const PRONOUN_SUBJECT_ONLY_RE =
  /^(?:(?:that|this|the)\s+(?:film|movie|one)|it|him|her|he|she|they)(?:\s+in)?$/i;

/** Exported for focused tests; only the closed pronoun/demonstrative subjects are declined. */
export function isPronounOnlySubject(message: string): boolean {
  const trimmed = message.trim().replace(/[?.!]+$/, '');
  if (PRONOUN_SUBJECT_ONLY_RE.test(trimmed)) return true;
  const withoutCue = trimmed.replace(CUE_PREFIX_RE, '').trim();
  return withoutCue !== trimmed && PRONOUN_SUBJECT_ONLY_RE.test(withoutCue);
}

export function isToolEligibleMessage(message: string): boolean {
  if (typeof message !== 'string' || isPronounOnlySubject(message)) return false;
  return PERSON_OR_CREDITS_RE.test(message);
}

/** Only these three declarations are ever sent to the model. */
export const TOOL_DECLARATIONS: readonly AssistantToolDeclaration[] = [
  {
    name: 'lookup_person',
    description:
      'Look up a film professional by name when their identity or known work is uncertain. ' +
      'Use this for a person question. Pass only the person name extracted from the user message.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person name, 2 to 60 characters.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_person_filmography',
    description:
      'Look up the movie credits of one named film professional: their filmography. ' +
      'Use this when the user asks what movies or films a person has been in. ' +
      'Pass only the person name extracted from the user message.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person name, 2 to 60 characters.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_movie_cast',
    description:
      'Look up a named movie and return its director names and up to eight cast names with characters. ' +
      'Use this when the user asks who directed, who starred in, or who is in a specific movie. ' +
      'Pass only the movie title extracted from the user message.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Movie title, 2 to 60 characters.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
];

function logToolUse(tool: LogTool, outcome: ToolUseOutcome): void {
  process.stdout.write(`${JSON.stringify({ verdict: 'tool-use', tool, outcome })}\n`);
}

/** Stable, non-reversible cache key; the name or title itself is never used as a key. */
function cacheKeyFor(tool: ToolName, query: string): string {
  const normalised = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return `assistant-tool:${crypto.createHash('blake2s256').update(`${tool}:${normalised}`).digest('hex')}`;
}

/** Reuses the shared search limiter bucket with a closed-set synthetic identity. */
async function withinToolRateLimit(tool: ToolName): Promise<boolean> {
  let limited = false;
  const reply = {
    header: () => reply,
    status: (code: number) => {
      if (code === 429) limited = true;
      return reply;
    },
    send: () => reply,
  } as unknown as FastifyReply;
  const request = {
    ip: `assistant-tool-${tool}`,
    id: 'assistant-tool',
  } as unknown as FastifyRequest;
  try {
    await searchRateLimit(request, reply);
    return !limited;
  } catch {
    return true;
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new AssistantTimeoutError('Assistant tool deadline exceeded.'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new AssistantTimeoutError('Assistant tool deadline exceeded.')),
      { once: true },
    );
  });
}

/** Only validated lookup text is passed to the TMDB adapters; never user or chat data. */
async function executeTool(tool: ToolName, value: string): Promise<ToolExecutionResult> {
  if (tool === 'lookup_person') {
    const people = await searchTmdbPeople(value);
    const items = people.slice(0, MAX_RESULT_ITEMS).map((person) => ({
      id: person.id,
      name: person.name,
      department: person.department,
    }));
    return { found: items.length > 0, response: { found: items.length > 0, items } };
  }

  if (tool === 'lookup_person_filmography') {
    const people = await searchTmdbPeople(value);
    if (people.length === 0) return { found: false, response: { found: false, items: [] } };
    const credits = await getTmdbPersonMovieCredits(people[0].id);
    const items = credits.slice(0, MAX_RESULT_ITEMS).map((credit) => ({
      id: credit.id,
      title: credit.title,
      year: credit.year,
      role: credit.role,
      department: credit.department,
    }));
    return { found: items.length > 0, response: { found: items.length > 0, items } };
  }

  const result = await getTmdbMovieCast(value);
  if (!result) return { found: false, response: { found: false } };
  const response = {
    found: result.directors.length > 0 || result.cast.length > 0,
    title: result.title,
    year: result.year,
    directors: result.directors.slice(0, MAX_RESULT_ITEMS),
    // Re-pick the structured fields at the tool boundary so no extra adapter
    // fields (including free text) can be forwarded to the model.
    cast: result.cast.slice(0, MAX_RESULT_ITEMS).map((item) => ({
      name: item.name,
      character: item.character,
    })),
  };
  return { found: response.found, response };
}

function parseToolCall(call: AssistantToolCall): { tool: ToolName; value: string } | null {
  if (!(TOOL_NAMES as readonly string[]).includes(call.name)) return null;
  const parsed = toolArgsSchema.safeParse(call.args);
  if (!parsed.success) return null;
  const raw = call.name === 'lookup_movie_cast' ? parsed.data.title : parsed.data.name;
  if (!raw) return null;
  const value = raw.trim();
  if (!isValidToolInput(value)) return null;
  return { tool: call.name as ToolName, value };
}

export async function runAssistantToolFlow(input: {
  system: string;
  history: AssistantHistoryItem[];
  message: string;
  model: string;
  timeoutMs: number;
  attempt?: AssistantAttempt;
}): Promise<AssistantToolFlowResult> {
  if (!isToolEligibleMessage(input.message)) return { used: false, outcome: 'skipped' };
  if (!env.GEMINI_API_KEY || !env.GEMINI_CHAT_MODEL) return { used: false, outcome: 'skipped' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TOOL_DEADLINE_MS);
  try {
    const first = await generateTurn({
      system: input.system,
      history: input.history,
      message: input.message,
      model: input.model,
      timeoutMs: input.timeoutMs,
      attempt: input.attempt,
      signal: controller.signal,
      tools: TOOL_DECLARATIONS,
    });

    if (first.toolCalls.length === 0) {
      logToolUse('none', 'skipped');
      return { used: true, outcome: 'skipped', text: first.text || undefined };
    }

    // One round only. A second round request or more than two calls is a cap event.
    if (first.toolCalls.length > MAX_TOOL_CALLS) {
      logToolUse('none', 'skipped');
      return { used: true, outcome: 'skipped' };
    }

    const results: AssistantToolResponse[] = [];
    let anyOk = false;
    let anyInvalid = false;
    let anyError = false;

    for (const call of first.toolCalls) {
      const parsed = parseToolCall(call);
      if (!parsed) {
        anyInvalid = true;
        logToolUse('none', 'invalid');
        results.push({ name: call.name, response: { found: false, items: [] } });
        continue;
      }

      const { tool, value } = parsed;
      try {
        const key = cacheKeyFor(tool, value);
        // Cache hit precedes the rate limiter and any TMDB call.
        const cached = await getCachedJson<CachedToolResult>(key);
        // Ignore entries written by the previous two-tool shape; overwrite them below.
        if (cached && typeof cached.found === 'boolean' && cached.response) {
          if (cached.found) anyOk = true;
          logToolUse(tool, cached.found ? 'ok' : 'none');
          results.push({ name: call.name, response: cached.response });
          continue;
        }

        if (!(await withinToolRateLimit(tool))) {
          logToolUse(tool, 'skipped');
          results.push({ name: call.name, response: { found: false, items: [] } });
          continue;
        }

        const executed = await Promise.race([
          executeTool(tool, value),
          abortPromise(controller.signal),
        ]);
        if (executed.found) anyOk = true;
        // Real outcomes only: errors and timeouts are never written to the cache.
        await setCachedJson(key, executed, CACHE_TTL_SECONDS);
        logToolUse(tool, executed.found ? 'ok' : 'none');
        results.push({ name: call.name, response: executed.response });
      } catch {
        anyError = true;
        logToolUse(tool, 'error');
        results.push({ name: call.name, response: { found: false, items: [] } });
      }
    }

    if (!anyOk) {
      return { used: true, outcome: anyInvalid ? 'invalid' : anyError ? 'error' : 'none' };
    }

    const final = await generateTurn({
      system: input.system,
      history: input.history,
      message: input.message,
      model: input.model,
      timeoutMs: input.timeoutMs,
      attempt: input.attempt,
      signal: controller.signal,
      priorToolCalls: first.toolCalls,
      toolResponses: results,
    });
    if (final.toolCalls.length > 0) {
      logToolUse('none', 'skipped');
      return { used: true, outcome: 'skipped' };
    }
    if (!final.text) {
      return { used: true, outcome: 'error' };
    }
    return {
      used: true,
      outcome: 'ok',
      text: `${final.text}\n\n${TMDB_TOOL_ATTRIBUTION_TEXT}`,
    };
  } catch {
    logToolUse('none', 'error');
    return { used: true, outcome: 'error' };
  } finally {
    clearTimeout(timer);
  }
}
