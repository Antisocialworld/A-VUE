import { GoogleGenAI } from '@google/genai';
import { env } from '../../env.js';

export type AssistantHistoryItem = {
  role: 'user' | 'assistant';
  text: string;
};

export type AssistantAttempt = 'primary' | 'fallback';

export class AssistantNotConfiguredError extends Error {
  constructor(message = 'Assistant is not configured.') {
    super(message);
    this.name = 'AssistantNotConfiguredError';
  }
}

export class AssistantRateLimitedError extends Error {
  status?: number;

  constructor(message = 'Assistant is busy.', status?: number) {
    super(message);
    this.name = 'AssistantRateLimitedError';
    this.status = status;
  }
}

export class AssistantGenerationError extends Error {
  status?: number;
  finishReason?: string;
  attempt?: AssistantAttempt;
  model?: string;
  latencyMs?: number;

  constructor(
    message = 'Assistant generation failed.',
    opts?: {
      status?: number;
      finishReason?: string;
      attempt?: AssistantAttempt;
      model?: string;
      latencyMs?: number;
    },
  ) {
    super(message);
    this.name = 'AssistantGenerationError';
    this.status = opts?.status;
    this.finishReason = opts?.finishReason;
    this.attempt = opts?.attempt;
    this.model = opts?.model;
    this.latencyMs = opts?.latencyMs;
  }
}

// Own deadline / caller abort. Uses a 504 status so the route's retry policy treats it
// like Gemini DEADLINE_EXCEEDED and falls back. 400/401/403/404 stay non-retryable;
// a 429 from Gemini is retryable via the fallback model.
export class AssistantTimeoutError extends AssistantGenerationError {
  constructor(
    message = 'Assistant request timed out.',
    opts?: { attempt?: AssistantAttempt; model?: string; latencyMs?: number },
  ) {
    super(message, { ...opts, status: 504 });
    this.name = 'AssistantTimeoutError';
  }
}

function getErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as {
    status?: unknown;
    code?: unknown;
    error?: { status?: unknown; code?: unknown };
  };
  if (typeof anyErr.status === 'number') return anyErr.status;
  if (typeof anyErr.code === 'number') return anyErr.code;
  if (typeof anyErr.code === 'string' && /^\d+$/.test(anyErr.code)) {
    return Number(anyErr.code);
  }
  // Gemini SDK errors can carry the HTTP status under the nested error body.
  const nested = anyErr.error && typeof anyErr.error === 'object' ? anyErr.error : undefined;
  if (nested) {
    if (typeof nested.status === 'number') return nested.status;
    if (typeof nested.code === 'number') return nested.code;
    if (typeof nested.status === 'string' && /^\d+$/.test(nested.status)) return Number(nested.status);
    if (typeof nested.code === 'string' && /^\d+$/.test(nested.code)) return Number(nested.code);
  }
  return undefined;
}

function getErrorStatusText(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as { statusText?: unknown; error?: { status?: unknown; code?: unknown } };
  if (typeof anyErr.statusText === 'string') return anyErr.statusText;
  if (anyErr.error && typeof anyErr.error === 'object') {
    if (typeof (anyErr.error as { status?: unknown }).status === 'string') {
      return (anyErr.error as { status: string }).status;
    }
    if (typeof (anyErr.error as { code?: unknown }).code === 'string') {
      return (anyErr.error as { code: string }).code;
    }
  }
  return undefined;
}

function isTimeoutOrAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name =
    typeof (err as { name?: unknown }).name === 'string'
      ? (err as { name: string }).name.toUpperCase()
      : '';
  if (name === 'ABORTERROR' || name === 'TIMEOUTERROR' || name === 'ASSISTANTTIMEOUTERROR') {
    return true;
  }
  const msg =
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message.toUpperCase()
      : '';
  return (
    msg.includes('TIMEOUT') ||
    msg.includes('TIMED OUT') ||
    msg.includes('ABORTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('DEADLINE EXCEEDED')
  );
}

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = getErrorStatus(err);
  if (status === 429) return true;
  const statusText = getErrorStatusText(err);
  if (typeof statusText === 'string' && statusText.toUpperCase().includes('RESOURCE_EXHAUSTED')) {
    return true;
  }
  const msg = typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message.toLowerCase() : '';
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('resource exhausted') || msg.includes('quota');
}

export function isRetryableServerError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  // A Gemini 429 is retryable via the fallback model. Our own limiter's 429 never reaches
  // this layer: the route rejects it before generate() is called.
  if (isRateLimitError(err)) return true;
  // 504 / DEADLINE_EXCEEDED and our own timeout or abort are retryable; 4xx above are not.
  if (isTimeoutOrAbortError(err)) return true;
  if (status === 503) return true;
  if (typeof status === 'number' && status >= 500) return true;

  const statusText = getErrorStatusText(err);
  if (typeof statusText === 'string') {
    const upper = statusText.toUpperCase();
    if (upper.includes('UNAVAILABLE') || upper.includes('DEADLINE_EXCEEDED')) return true;
  }

  const msg = typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message.toUpperCase() : '';
  if (msg.includes('UNAVAILABLE') || msg.includes('503')) {
    return true;
  }
  return false;
}

function cutToLastFullSentence(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const matches = [...trimmed.matchAll(/[.!?](?=\s|$|["')\]])/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const endIndex = (last.index ?? 0) + 1;
  const cut = trimmed.slice(0, endIndex).trim();
  return cut || null;
}

export async function generate(input: {
  system: string;
  history: AssistantHistoryItem[];
  message: string;
  model?: string;
  timeoutMs?: number;
  attempt?: AssistantAttempt;
  signal?: AbortSignal;
}): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  const model = input.model ?? env.GEMINI_CHAT_MODEL;
  if (!apiKey || !model) {
    throw new AssistantNotConfiguredError();
  }

  const ai = new GoogleGenAI({ apiKey });
  const contents = [
    ...input.history.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.text }],
    })),
    {
      role: 'user' as const,
      parts: [{ text: input.message }],
    },
  ];

  const timeoutMs = input.timeoutMs ?? env.GEMINI_ATTEMPT_TIMEOUT_MS;
  const attempt = input.attempt ?? 'primary';
  const start = Date.now();
  const callerSignal = input.signal;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCallerAbort: (() => void) | undefined;

  // Own hard deadline: SDK httpOptions.timeout only aborts its fetch attempt
  // (server/node_modules/@google/genai/dist/node/index.mjs:23795-23817); a hung body read
  // would leave the route awaiting forever and no 'request completed' line would be emitted.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AssistantTimeoutError('Assistant request timed out.', { attempt, model, latencyMs: timeoutMs }));
    }, timeoutMs);
  });

  const callerAborted = callerSignal
    ? new Promise<never>((_, reject) => {
        const abort = () => {
          controller.abort();
          reject(new AssistantTimeoutError('Assistant request aborted.', {
            attempt,
            model,
            latencyMs: Date.now() - start,
          }));
        };
        if (callerSignal.aborted) {
          abort();
        } else {
          onCallerAbort = abort;
          callerSignal.addEventListener('abort', abort, { once: true });
        }
      })
    : undefined;

  try {
    const requests: Promise<unknown>[] = [
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: input.system,
          temperature: 0.3,
          maxOutputTokens: 600,
          // Lowest supported thinking setting for this SDK chat call (Task 1): thinkingBudget 0 disables thinking.
          // Evidence: server/node_modules/@google/genai/dist/genai.d.ts:18010-18016 (ThinkingConfig.thinkingBudget?: number, "0 is DISABLED").
          // Evidence: server/node_modules/@google/genai/dist/genai.d.ts:7260-7288 (GenerateContentConfig.thinkingConfig?: ThinkingConfig).
          // Evidence (finish reason): server/node_modules/@google/genai/dist/genai.d.ts:1948 (Candidate.finishReason?: FinishReason), 6492-6510 (FinishReason.MAX_TOKENS).
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: controller.signal,
          httpOptions: {
            timeout: timeoutMs,
            retryOptions: {
              attempts: 1,
            },
          },
        },
      } as any),
      deadline,
    ];
    if (callerAborted) requests.push(callerAborted);
    const response = await Promise.race(requests);

    const latencyMs = Date.now() - start;
    const rawText = typeof (response as any)?.text === 'string' ? (response as any).text.trim() : '';
    const finishReason = (response as any)?.candidates?.[0]?.finishReason as string | undefined;

    if (finishReason === 'MAX_TOKENS' && rawText) {
      const cut = cutToLastFullSentence(rawText);
      if (!cut) {
        throw new AssistantGenerationError('empty_or_blocked', {
          finishReason,
          attempt,
          model,
          latencyMs,
        });
      }
      return cut;
    }

    if (!rawText) {
      throw new AssistantGenerationError('empty_or_blocked', {
        finishReason,
        attempt,
        model,
        latencyMs,
      });
    }

    return rawText;
  } catch (err: unknown) {
    if (err instanceof AssistantTimeoutError) throw err;
    const latencyMs = Date.now() - start;
    if (err instanceof AssistantGenerationError) {
      if (err.latencyMs === undefined) err.latencyMs = latencyMs;
      if (!err.attempt) err.attempt = attempt;
      if (!err.model) err.model = model;
      throw err;
    }
    if (err instanceof AssistantNotConfiguredError || err instanceof AssistantRateLimitedError) {
      throw err;
    }
    if (isRateLimitError(err)) {
      throw new AssistantRateLimitedError('Assistant is busy.', getErrorStatus(err));
    }
    throw new AssistantGenerationError('Assistant generation failed.', {
      status: getErrorStatus(err),
      attempt,
      model,
      latencyMs,
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (callerSignal && onCallerAbort) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}
