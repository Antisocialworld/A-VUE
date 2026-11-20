import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { getCachedJson, setCachedJson, getTmdbPersonMovieCredits, searchTmdbPeople } from '../tmdb.js';
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
export const TOOL_NAMES = ['lookup_person', 'lookup_movie_credits'] as const;
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
type CachedToolResult = { items: Array<Record<string, unknown>>; empty: boolean };

export type AssistantToolFlowResult = {
  /** True when the message was eligible and the tool path actually ran. */
  used: boolean;
  outcome: ToolUseOutcome;
  /** Final, attributed answer only when outcome is 'ok' (or a declined tool turn). */
  text?: string;
};

const toolArgsSchema = z.object({ name: z.string() }).strict();

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

/** Narrow eligibility for offering tools. Nothing here refuses or bans any film question. */
const PERSON_OR_CREDITS_RE =
  /\b(who(?:\s+is|\s+was|'s)|actor|actress|director|filmmaker|producer|screenwriter|filmography|cast|crew|credits?|starred|starring|born|biography|known\s+for|played\s+in|appeared\s+in)\b/i;

export function isToolEligibleMessage(message: string): boolean {
  return typeof message === 'string' && PERSON_OR_CREDITS_RE.test(message);
}

/** Only these two declarations are ever sent to the model. */
export const TOOL_DECLARATIONS: readonly AssistantToolDeclaration[] = [
  {
    name: 'lookup_person',
    description:
      'Look up a film professional by name when their identity or known work is uncertain. ' +
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
    name: 'lookup_movie_credits',
    description:
      'Look up the movie cast and crew credits of a film professional. ' +
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
];

function logToolUse(tool: LogTool, outcome: ToolUseOutcome): void {
  process.stdout.write(`${JSON.stringify({ verdict: 'tool-use', tool, outcome })}\n`);
}

/** Stable, non-reversible cache key; the name itself is never used as a key. */
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

/** Only the validated person name is passed to the TMDB adapter; never user or chat data. */
async function executeTool(
  tool: ToolName,
  name: string,
): Promise<{ items: Array<Record<string, unknown>> }> {
  if (tool === 'lookup_person') {
    const people = await searchTmdbPeople(name);
    return {
      items: people.slice(0, MAX_RESULT_ITEMS).map((person) => ({
        id: person.id,
        name: person.name,
        department: person.department,
      })),
    };
  }

  const people = await searchTmdbPeople(name);
  if (people.length === 0) return { items: [] };
  const credits = await getTmdbPersonMovieCredits(people[0].id);
  return {
    items: credits.slice(0, MAX_RESULT_ITEMS).map((credit) => ({
      id: credit.id,
      title: credit.title,
      year: credit.year,
      role: credit.role,
      department: credit.department,
    })),
  };
}

function parseToolCall(call: AssistantToolCall): { tool: ToolName; name: string } | null {
  if (!(TOOL_NAMES as readonly string[]).includes(call.name)) return null;
  const parsed = toolArgsSchema.safeParse(call.args);
  if (!parsed.success) return null;
  const name = parsed.data.name.trim();
  if (!isValidToolInput(name)) return null;
  return { tool: call.name as ToolName, name };
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

      const { tool, name } = parsed;
      try {
        const key = cacheKeyFor(tool, name);
        // Cache hit precedes the rate limiter and any TMDB call.
        const cached = await getCachedJson<CachedToolResult>(key);
        if (cached) {
          if (cached.items.length > 0) anyOk = true;
          logToolUse(tool, cached.items.length > 0 ? 'ok' : 'none');
          results.push({
            name: call.name,
            response: { found: cached.items.length > 0, items: cached.items },
          });
          continue;
        }

        if (!(await withinToolRateLimit(tool))) {
          logToolUse(tool, 'skipped');
          results.push({ name: call.name, response: { found: false, items: [] } });
          continue;
        }

        const executed = await Promise.race([
          executeTool(tool, name),
          abortPromise(controller.signal),
        ]);
        const items = executed.items.slice(0, MAX_RESULT_ITEMS);
        if (items.length > 0) anyOk = true;
        // Real outcomes only: errors and timeouts are never written to the cache.
        await setCachedJson(key, { items, empty: items.length === 0 }, CACHE_TTL_SECONDS);
        logToolUse(tool, items.length > 0 ? 'ok' : 'none');
        results.push({
          name: call.name,
          response: { found: items.length > 0, items },
        });
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
