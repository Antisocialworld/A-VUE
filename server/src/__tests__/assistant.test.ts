import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSessionUser = vi.fn();
const mockAssistantRateLimit = vi.fn();
const mockGenerate = vi.fn();
const mockGenerateContent = vi.fn();
const mockGoogleGenAI = vi.fn();
const mockCorrectMovieTitle = vi.fn();
const mockCorrectedSearch = vi.fn();

vi.mock('../lib/session.js', () => ({
  getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

vi.mock('../lib/rateLimit.js', async () => {
  const actual = await vi.importActual<any>('../lib/rateLimit.js');
  return {
    ...actual,
    assistantRateLimit: (...args: unknown[]) => mockAssistantRateLimit(...args),
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: function GoogleGenAI(this: any, opts: any) {
    mockGoogleGenAI(opts);
    this.models = {
      generateContent: (...args: unknown[]) => mockGenerateContent(...args),
    };
  },
}));

const baseEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '0.0.0.0',
  TRUST_PROXY: false,
  REQUEST_TIMEOUT_MS: 10000,
  BODY_LIMIT_KB: 100,
  GEMINI_API_KEY: 'test-key',
  GEMINI_CHAT_MODEL: 'gemini-test-model',
  GEMINI_ATTEMPT_TIMEOUT_MS: 8000,
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-2',
  EMBEDDING_DIMENSIONS: 768,
};

async function buildTestServer(envOverrides: Record<string, unknown> = {}) {
  vi.resetModules();

  vi.doMock('../env.js', () => ({
    env: { ...baseEnv, ...envOverrides },
    isAdmin: () => false,
    getTmdbToken: () => undefined,
    getSearchCacheTtlSeconds: () => 600,
  }));

  vi.doMock('../lib/session.js', () => ({
    getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
    UnauthorizedError: class UnauthorizedError extends Error {
      constructor(message = 'Unauthorized') {
        super(message);
        this.name = 'UnauthorizedError';
      }
    },
  }));

  vi.doMock('../lib/rateLimit.js', async () => {
    const actual = await vi.importActual<any>('../lib/rateLimit.js');
    return {
      ...actual,
      assistantRateLimit: (...args: unknown[]) => mockAssistantRateLimit(...args),
    };
  });

  // Keep other routes from needing external services during tests where possible.
  vi.doMock('../routes/health.js', () => ({ healthRoutes: async () => {} }));
  vi.doMock('../routes/dev.js', () => ({ devRoutes: async () => {} }));
  vi.doMock('../routes/auth.js', () => ({ authRoutes: async () => {} }));
  vi.doMock('../routes/movies.js', () => ({ movieRoutes: async () => {} }));
  vi.doMock('../routes/showtimes.js', () => ({ showtimeRoutes: async () => {} }));
  vi.doMock('../routes/checkout.js', () => ({ checkoutRoutes: async () => {} }));
  vi.doMock('../routes/webhooks.js', () => ({ webhookRoutes: async () => {} }));
  vi.doMock('../routes/tickets.js', () => ({ ticketRoutes: async () => {} }));
  vi.doMock('../routes/cron.js', () => ({ cronRoutes: async () => {} }));

  vi.doMock('../lib/assistant/model.js', async () => {
    const actual = await vi.importActual<any>('../lib/assistant/model.js');
    return {
      ...actual,
      generate: (...args: unknown[]) => mockGenerate(...args),
    };
  });

  const { buildServer } = await import('../server.js');
  return buildServer();
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset queued once-values too, so a mock from one test cannot leak into the next.
  mockGenerate.mockReset();
  mockGenerateContent.mockReset();
  mockGetSessionUser.mockResolvedValue({ id: 'user-123', email: 'user@example.com', status: 'active' });
  mockAssistantRateLimit.mockResolvedValue(true);
  mockGenerate.mockResolvedValue('Hello from A VUE.');
  mockGenerateContent.mockResolvedValue({ text: 'Hello from A VUE.' });
});

// Cold-loads Fastify/Zod/pg/Redis/TMDB/Gemini through buildTestServer(). Without a
// warm-up the first test pays that cost inside its own 5 s deadline and times out.
beforeAll(async () => {
  const warmupServer = await buildTestServer();
  await warmupServer.close();
}, 20000);

describe('Ask A VUE assistant route', () => {
  it('requires auth (401) and does not call generate', async () => {
    mockGetSessionUser.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { name: 'UnauthorizedError' }));
    const server = await buildTestServer();
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How do I book tickets?' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('returns 429 when rate limited', async () => {
    mockAssistantRateLimit.mockImplementationOnce(async (_req: any, reply: any) => {
      reply.status(429).send({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.', requestId: _req.id },
      });
      return false;
    });
    const server = await buildTestServer();
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How do I book tickets?' },
    });
    expect(res.statusCode).toBe(429);
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('validates message and history limits (400)', async () => {
    const server = await buildTestServer();
    const tooLong = 'a'.repeat(301);
    const res1 = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: tooLong } });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().error.code).toBe('VALIDATION_ERROR');

    const res2 = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: {
        message: 'Hi',
        history: [
          { role: 'user', text: '1' },
          { role: 'assistant', text: '2' },
          { role: 'user', text: '3' },
          { role: 'assistant', text: '4' },
          { role: 'user', text: '5' },
        ],
      },
    });
    expect(res2.statusCode).toBe(400);

    const res3 = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Hi', history: [{ role: 'assistant', text: 'x'.repeat(601) }] },
    });
    expect(res3.statusCode).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('returns 503 when GEMINI_API_KEY or GEMINI_CHAT_MODEL is missing (friendly, no raw Gemini text)', async () => {
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/not available/i);
    expect(JSON.stringify(res.json())).not.toContain('google');
    await server.close();
  });

  it('passes system prompt with Lagos date/contact, capped history, and no user fields to generate', async () => {
    const server = await buildTestServer();
    const payload = {
      message: 'How do I book tickets?',
      history: [
        { role: 'user' as const, text: 'Hi' },
        { role: 'assistant' as const, text: 'Hello' },
      ],
    };
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Hello from A VUE.' });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const call = mockGenerate.mock.calls[0][0];
    expect(call.message).toBe(payload.message);
    expect(call.history).toEqual(payload.history);
    expect(call.system).toContain('Today in Lagos is');
    expect(call.system).toContain('0800 000 0000');
    expect(call.system).not.toContain('user-123');
    expect(call.system).not.toContain('user@example.com');
    expect(call.system).not.toContain('GEMINI');
    await server.close();
  });

  it('other-vue message returns fixed refusal with no model call and no message text in logs', async () => {
    const { SCOPE_REFUSAL_TEXT } = await import('../lib/assistant/scopeGuard.js');
    const server = await buildTestServer();
    const infoCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, _reply, done) => {
      const origInfo = req.log.info.bind(req.log);
      (req.log as any).info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        infoCalls.push([obj, msg]);
        return (origInfo as any)(obj, msg, ...rest);
      };
      done();
    });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'how do I use Vue.js' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: SCOPE_REFUSAL_TEXT });
    expect(mockGenerate).not.toHaveBeenCalled();
    const scopeLogCalls = infoCalls.filter((c) => c[1] === 'assistant_scope_verdict');
    expect(scopeLogCalls.length).toBeGreaterThan(0);
    for (const call of scopeLogCalls) {
      expect(call[0]).toMatchObject({ verdict: 'other-vue' });
      expect(JSON.stringify(call)).not.toContain('how do I use Vue.js');
    }
    await server.close();
  });

  it('ok brand-variant message makes exactly one model call with normalised text and normalised user history', async () => {
    const server = await buildTestServer();
    const infoCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, _reply, done) => {
      const origInfo = req.log.info.bind(req.log);
      (req.log as any).info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        infoCalls.push([obj, msg]);
        return (origInfo as any)(obj, msg, ...rest);
      };
      done();
    });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: {
        message: 'how do i book at avue',
        history: [
          { role: 'user', text: 'a view tonight?' },
          { role: 'assistant', text: 'Earlier reply' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const call = mockGenerate.mock.calls[0][0];
    expect(call.message).toBe('how do i book at A VUE');
    expect(call.history).toEqual([
      { role: 'user', text: 'A VUE tonight?' },
      { role: 'assistant', text: 'Earlier reply' },
    ]);
    const scopeLogCalls = infoCalls.filter((c) => c[1] === 'assistant_scope_verdict');
    expect(scopeLogCalls.length).toBeGreaterThan(0);
    for (const callArgs of scopeLogCalls) {
      expect(callArgs[0]).toMatchObject({ verdict: 'ok' });
      expect(JSON.stringify(callArgs)).not.toContain('how do i book at avue');
      expect(JSON.stringify(callArgs)).not.toContain('a view tonight?');
    }
    const factsLogCalls = infoCalls.filter((c) => c[1] === 'assistant_facts_verdict');
    expect(factsLogCalls).toHaveLength(1);
    expect(factsLogCalls[0][0]).toEqual({ verdict: 'ok' });
    expect(JSON.stringify(factsLogCalls[0])).not.toContain('how do i book at avue');
    await server.close();
  });

  it('deterministically gates live-fact lookups with a fixed reply and verdict-only logs', async () => {
    const { factsRefusalText } = await import('../lib/assistant/factsGate.js');
    const server = await buildTestServer();
    const infoCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, _reply, done) => {
      const origInfo = req.log.info.bind(req.log);
      (req.log as any).info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        infoCalls.push([obj, msg]);
        return (origInfo as any)(obj, msg, ...rest);
      };
      done();
    });
    const message = 'What are your opening hours?';
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: factsRefusalText(message) });
    expect(res.json().reply).toContain('0800 000 0000');
    expect(mockGenerate).not.toHaveBeenCalled();

    const factsLogCalls = infoCalls.filter((c) => c[1] === 'assistant_facts_verdict');
    expect(factsLogCalls).toHaveLength(1);
    expect(factsLogCalls[0][0]).toEqual({ verdict: 'needs-facts' });
    expect(Object.keys(factsLogCalls[0][0] as Record<string, unknown>).sort()).toEqual(['verdict']);
    expect(JSON.stringify(factsLogCalls[0])).not.toContain(message);
    await server.close();
  });

  it('gates suggested fact prompts and documented live-fact keywords while allowing procedural questions', async () => {
    const { checkFacts, FACT_KEYWORDS } = await import('../lib/assistant/factsGate.js');
    expect(FACT_KEYWORDS.length).toBeGreaterThan(0);

    const blocked = [
      'Refund policy',
      'Opening hours',
      'Age ratings',
      'What movies are on?',
      'whats on at avue',
      'Ticket prices',
      'Where is A VUE?',
      'Showtimes today',
      'My booking status',
      'Can I cancel my ticket?',
    ];
    for (const message of blocked) {
      expect(checkFacts(message).kind).toBe('needs-facts');
    }

    const allowed = ['Hi', 'How do I book tickets?', 'How do I use the app?', 'Thank you'];
    for (const message of allowed) {
      expect(checkFacts(message).kind).toBe('ok');
    }
  });

  it('maps Gemini rate limit to friendly 429 and does not leak raw error text', async () => {
    const server = await buildTestServer();
    const { AssistantRateLimitedError } = await import('../lib/assistant/model.js');
    mockGenerate.mockRejectedValueOnce(new AssistantRateLimitedError('RESOURCE_EXHAUSTED secret', 429));
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toBe('Ask A VUE is busy right now. Try again shortly.');
    expect(JSON.stringify(res.json())).not.toContain('RESOURCE_EXHAUSTED');
    expect(JSON.stringify(res.json())).not.toContain('secret');
    await server.close();
  });

  it('maps empty/blocked or Gemini failure to friendly 502 and does not leak raw error text', async () => {
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    mockGenerate.mockRejectedValueOnce(new AssistantGenerationError('SAFETY blocked raw detail'));
    const server = await buildTestServer();
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/could not respond/i);
    expect(JSON.stringify(res.json())).not.toContain('SAFETY');
    expect(JSON.stringify(res.json())).not.toContain('raw detail');
    await server.close();
  });
});

describe('assistant model and prompt', () => {
  it('buildSystemPrompt includes Lagos date and placeholder contact, plain text', async () => {
    vi.resetModules();
    const { buildSystemPrompt, ASSISTANT_SUPPORT_CONTACT } = await import('../lib/assistant/systemPrompt.js');
    const prompt = buildSystemPrompt('Wednesday 18 November 2026');
    expect(ASSISTANT_SUPPORT_CONTACT).toBe('0800 000 0000');
    expect(prompt).toContain('Wednesday 18 November 2026');
    expect(prompt).toContain('0800 000 0000');
    expect(prompt).not.toMatch(/[*_`#\[\]]/); // no Markdown markers
  });

  it('prompt restricts facts to prompt data, forbids tool promises and branch guessing, points to in-app screens, and caps replies at 3 sentences', async () => {
    vi.resetModules();
    const { buildSystemPrompt } = await import('../lib/assistant/systemPrompt.js');
    const prompt = buildSystemPrompt('Wednesday 18 November 2026');

    const requiredFragments = [
      'For A VUE details, state a fact only if it is given in the conversation.',
      'Never invent A VUE hours, prices, showtimes, policies or what is playing.',
      'say it cannot be confirmed here and point to the A VUE support contact at 0800 000 0000.',
      'Never guess and never give typical values.',
      'You have no tools.',
      'Never offer or promise to check, look up, book, cancel or refund anything',
      'never say "I will check"',
      'Do not ask the user which branch or location they mean',
      'Direct branch-specific questions to the Showtimes screen.',
      'Do not say "check the A VUE app"',
      'open the Showtimes or Tickets screens',
      'At most 3 short sentences, in plain text.',
      'cinema opening hours',
      '0800 000 0000',
    ];
    for (const fragment of requiredFragments) {
      expect(prompt).toContain(fragment);
    }
    expect(prompt).not.toContain('Every question is about the A VUE cinema');
    expect(prompt).not.toContain('do not assume more than one branch exists');
    expect(prompt).not.toContain('Facts block');
    expect(prompt).not.toMatch(/[*_`#\[\]]/); // no Markdown markers
  });

  it('allows general film questions while still forbidding invented A VUE facts', async () => {
    vi.resetModules();
    const { buildSystemPrompt } = await import('../lib/assistant/systemPrompt.js');
    const prompt = buildSystemPrompt('Wednesday 18 November 2026');
    expect(prompt).toContain(
      'A VUE has two cinemas in Lagos (Victoria Island and Ikeja City Mall); the assistant helps with A VUE and with movies, cinema, entertainment and film professions in general.',
    );
    expect(prompt).toContain(
      'For general film knowledge you may answer from your own knowledge. If you are not sure, say you are not sure.',
    );
    expect(prompt).toContain(
      'Do not state release dates, cast or plot details as certain unless you are confident; you may suggest asking for the poster to get the overview.',
    );
    expect(prompt).toContain('Never invent A VUE hours, prices, showtimes, policies or what is playing.');
    expect(prompt).toContain('For unrelated topics, politely say you can only help with cinema, movies, entertainment, film professions or A VUE.');
  });

  it('generate maps assistant history role to model and sets system/temperature/tokens/timeout, thinking, and one attempt', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/assistant/model.js');
    vi.doMock('../env.js', () => ({ env: { ...baseEnv } }));
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: function GoogleGenAI(this: any, opts: any) {
        mockGoogleGenAI(opts);
        this.models = { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
      },
    }));
    mockGenerateContent.mockResolvedValueOnce({ text: 'Reply' });
    const { generate } = await import('../lib/assistant/model.js');
    const out = await generate({
      system: 'sys',
      history: [
        { role: 'user', text: 'u1' },
        { role: 'assistant', text: 'a1' },
      ],
      message: 'm',
    });
    expect(out).toBe('Reply');
    expect(mockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.model).toBe('gemini-test-model');
    expect(arg.config.systemInstruction).toBe('sys');
    expect(arg.config.temperature).toBe(0.3);
    expect(arg.config.maxOutputTokens).toBe(600);
    expect(arg.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(arg.config.httpOptions.timeout).toBe(10000); // 8000 configured -> 10000 floor
    expect(arg.config.httpOptions.retryOptions.attempts).toBe(1);
    expect(arg.config.tools).toBeUndefined();
    expect(arg.config.toolConfig).toBeUndefined();
    expect(arg.contents).toEqual([
      { role: 'user', parts: [{ text: 'u1' }] },
      { role: 'model', parts: [{ text: 'a1' }] },
      { role: 'user', parts: [{ text: 'm' }] },
    ]);
  });

  it('clamps a configured timeout below 10000 ms up to the Gemini minimum', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/assistant/model.js');
    vi.doMock('../env.js', () => ({ env: { ...baseEnv, GEMINI_ATTEMPT_TIMEOUT_MS: 4000 } }));
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: function GoogleGenAI(this: any) {
        this.models = { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
      },
    }));
    mockGenerateContent.mockResolvedValueOnce({ text: 'Reply' });
    const { generate } = await import('../lib/assistant/model.js');
    await generate({ system: 'sys', history: [], message: 'm' });
    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.config.httpOptions.timeout).toBe(10000);
    expect(arg.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('generate throws typed error on empty/blocked reply', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/assistant/model.js');
    vi.doMock('../env.js', () => ({ env: { ...baseEnv } }));
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: function GoogleGenAI(this: any) {
        this.models = { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
      },
    }));
    mockGenerateContent.mockResolvedValueOnce({ text: '' });
    const mod = await import('../lib/assistant/model.js');
    await expect(mod.generate({ system: 's', history: [], message: 'm' })).rejects.toBeInstanceOf(mod.AssistantGenerationError);
  });

  it('cuts truncated MAX_TOKENS reply to the last full sentence', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/assistant/model.js');
    vi.doMock('../env.js', () => ({ env: { ...baseEnv } }));
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: function GoogleGenAI(this: any) {
        this.models = { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
      },
    }));
    mockGenerateContent.mockResolvedValueOnce({
      text: 'First sentence. Second sentence is cut mid',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });
    const mod = await import('../lib/assistant/model.js');
    const out = await mod.generate({ system: 's', history: [], message: 'm' });
    expect(out).toBe('First sentence.');
  });

  it('treats MAX_TOKENS reply with no full sentence as empty-reply generation error', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/assistant/model.js');
    vi.doMock('../env.js', () => ({ env: { ...baseEnv } }));
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: function GoogleGenAI(this: any) {
        this.models = { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
      },
    }));
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Hello Welcome to A VUE How can',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });
    const mod = await import('../lib/assistant/model.js');
    await expect(mod.generate({ system: 's', history: [], message: 'm' })).rejects.toBeInstanceOf(mod.AssistantGenerationError);
  });

  it('treats Gemini 429 as retryable while 400, 401, 403 and 404 stay non-retryable', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/assistant/model.js');
    vi.doMock('../env.js', () => ({ env: { ...baseEnv } }));
    const mod = await import('../lib/assistant/model.js');

    expect(mod.isRetryableServerError(new mod.AssistantRateLimitedError('busy', 429))).toBe(true);
    expect(mod.isRetryableServerError({ status: 429 })).toBe(true);
    for (const status of [400, 401, 403, 404]) {
      expect(mod.isRetryableServerError(new mod.AssistantGenerationError('bad request', { status }))).toBe(false);
    }
  });

  it('rejects with a retryable timeout when its own deadline fires on a hung SDK call', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      vi.doUnmock('../lib/assistant/model.js');
      vi.doMock('../env.js', () => ({ env: { ...baseEnv } }));
      vi.doMock('@google/genai', () => ({
        GoogleGenAI: function GoogleGenAI(this: any) {
          this.models = { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
        },
      }));
      mockGenerateContent.mockImplementationOnce(() => new Promise(() => {}));
      const mod = await import('../lib/assistant/model.js');
      // 20 ms is clamped to the 10000 ms floor, so advance the fake clock to that deadline.
      const pending = mod.generate({
        system: 's',
        history: [],
        message: 'm',
        timeoutMs: 20,
        attempt: 'primary',
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(mod.AssistantTimeoutError);
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
      expect(mod.isRetryableServerError(new mod.AssistantTimeoutError())).toBe(true);
      expect(mod.isRetryableServerError({ error: { code: 504, status: 'DEADLINE_EXCEEDED' } })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('assistant fallback and failure logging', () => {
  it('uses fallback model on 503 UNAVAILABLE failure and returns fallback reply', async () => {
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    mockGenerate
      .mockRejectedValueOnce(new AssistantGenerationError('primary failed', { status: 503 }))
      .mockResolvedValueOnce('Fallback reply');
    const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Fallback reply' });
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[0][0].model).toBe('gemini-test-model');
    expect(mockGenerate.mock.calls[0][0].attempt).toBe('primary');
    expect(mockGenerate.mock.calls[1][0].model).toBe('gemini-fallback-model');
    expect(mockGenerate.mock.calls[1][0].attempt).toBe('fallback');
    expect(mockGenerate.mock.calls[0][0].timeoutMs).toBe(8000);
    expect(mockGenerate.mock.calls[1][0].timeoutMs).toBe(8000);
    await server.close();
  });

  it('uses the configured timeout and caps the fallback so both attempts stay under the app 27 s deadline', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(fixedNow);
    let server: Awaited<ReturnType<typeof buildTestServer>> | undefined;

    try {
      server = await buildTestServer({
        GEMINI_FALLBACK_MODEL: 'gemini-fallback-model',
        GEMINI_ATTEMPT_TIMEOUT_MS: 15000,
      });
      const { AssistantGenerationError } = await import('../lib/assistant/model.js');
      mockGenerate
        .mockImplementationOnce(async () => {
          vi.setSystemTime(fixedNow + 15000);
          throw new AssistantGenerationError('slow primary failed', { status: 503 });
        })
        .mockResolvedValueOnce('Fallback reply');

      const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ reply: 'Fallback reply' });
      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(mockGenerate.mock.calls[0][0].timeoutMs).toBe(15000);
      // Primary used 15 s, so the route caps the fallback to a 24 s total budget; generate()
      // still applies its 10 s floor (worst case 15 s + 10 s = 25 s, inside the app's 27 s abort).
      expect(mockGenerate.mock.calls[1][0].timeoutMs).toBe(9000);
      expect(15000 + mockGenerate.mock.calls[1][0].timeoutMs).toBeLessThan(27000);
    } finally {
      if (server) await server.close();
      vi.useRealTimers();
    }
  });

  it('uses fallback on 504 DEADLINE_EXCEEDED and on an abort without a numeric status', async () => {
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    const primaryErrors: unknown[] = [
      new AssistantGenerationError('{"error":{"code":504,"status":"DEADLINE_EXCEEDED"}}', { status: 504 }),
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    ];
    for (const primaryError of primaryErrors) {
      mockGenerate.mockReset();
      mockGenerate.mockRejectedValueOnce(primaryError).mockResolvedValueOnce('Fallback reply');
      const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
      const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ reply: 'Fallback reply' });
      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(mockGenerate.mock.calls[1][0].model).toBe('gemini-fallback-model');
      expect(mockGenerate.mock.calls[1][0].attempt).toBe('fallback');
      await server.close();
    }
  });

  it('uses fallback when our own primary timeout fires', async () => {
    const { AssistantTimeoutError } = await import('../lib/assistant/model.js');
    mockGenerate.mockRejectedValueOnce(new AssistantTimeoutError()).mockResolvedValueOnce('Fallback reply');
    const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Fallback reply' });
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[0][0].attempt).toBe('primary');
    expect(mockGenerate.mock.calls[1][0].attempt).toBe('fallback');
    await server.close();
  });

  it('returns the friendly error and completes when both attempts fail', async () => {
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    mockGenerate
      .mockRejectedValueOnce(new AssistantGenerationError('raw primary 504 detail', { status: 504 }))
      .mockRejectedValueOnce(new AssistantGenerationError('raw fallback 503 detail', { status: 503 }));
    const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
    const infoCalls: Array<[unknown, unknown]> = [];
    const warnCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, reply, done) => {
      const origInfo = reply.log.info.bind(reply.log);
      const origWarn = reply.log.warn.bind(reply.log);
      (reply.log as any).info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        infoCalls.push([obj, msg]);
        return (origInfo as any)(obj, msg, ...rest);
      };
      (reply.log as any).warn = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        warnCalls.push([obj, msg]);
        return (origWarn as any)(obj, msg, ...rest);
      };
      done();
    });
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/could not respond/i);
    expect(JSON.stringify(res.json())).not.toContain('raw primary');
    expect(JSON.stringify(res.json())).not.toContain('raw fallback');
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    const failures = warnCalls.filter((c) => c[1] === 'assistant_generate_failed');
    expect(failures).toHaveLength(2);
    expect(failures.map((c) => (c[0] as { attempt?: unknown }).attempt)).toEqual(['primary', 'fallback']);
    for (const call of failures) {
      expect(JSON.stringify(call)).not.toContain('raw primary 504 detail');
      expect(JSON.stringify(call)).not.toContain('raw fallback 503 detail');
    }
    expect(infoCalls.some((c) => c[1] === 'request completed')).toBe(true);
    await server.close();
  });

  it('logs one success line per attempt with attempt and model and no message text', async () => {
    const server = await buildTestServer();
    const infoCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, reply, done) => {
      const origInfo = reply.log.info.bind(reply.log);
      (reply.log as any).info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        infoCalls.push([obj, msg]);
        return (origInfo as any)(obj, msg, ...rest);
      };
      done();
    });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'secret user question', history: [{ role: 'user', text: 'secret history' }] },
    });
    expect(res.statusCode).toBe(200);
    const successLogs = infoCalls.filter((c) => c[1] === 'assistant_generate_ok');
    expect(successLogs).toHaveLength(1);
    expect(successLogs[0][0]).toMatchObject({
      attempt: 'primary',
      model: 'gemini-test-model',
      outcome: 'ok',
    });
    expect((successLogs[0][0] as { latencyMs?: unknown }).latencyMs).toEqual(expect.any(Number));
    expect(JSON.stringify(successLogs[0])).not.toContain('secret user question');
    expect(JSON.stringify(successLogs[0])).not.toContain('secret history');
    expect(infoCalls.some((c) => c[1] === 'request completed')).toBe(true);
    await server.close();
  });

  it('does not use fallback on 400, 401, 403, or 404', async () => {
    const statuses = [400, 401, 403, 404] as const;
    for (const status of statuses) {
      mockGenerate.mockReset();
      const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
      const { AssistantGenerationError } = await import('../lib/assistant/model.js');
      mockGenerate.mockRejectedValueOnce(new AssistantGenerationError(`status ${status}`, { status }));
      const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
      expect(res.statusCode).toBe(502);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      await server.close();
    }
  });

  it('uses the fallback once when Gemini returns 429 on the primary model', async () => {
    const { AssistantRateLimitedError } = await import('../lib/assistant/model.js');
    mockGenerate
      .mockRejectedValueOnce(new AssistantRateLimitedError('RESOURCE_EXHAUSTED raw primary detail', 429))
      .mockResolvedValueOnce('Fallback reply');
    const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Fallback reply' });
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[0][0].model).toBe('gemini-test-model');
    expect(mockGenerate.mock.calls[0][0].attempt).toBe('primary');
    expect(mockGenerate.mock.calls[1][0].model).toBe('gemini-fallback-model');
    expect(mockGenerate.mock.calls[1][0].attempt).toBe('fallback');
    expect(mockGenerate.mock.calls[0][0].timeoutMs).toBe(8000);
    expect(mockGenerate.mock.calls[1][0].timeoutMs).toBe(8000);
    expect(JSON.stringify(res.json())).not.toContain('RESOURCE_EXHAUSTED');
    expect(JSON.stringify(res.json())).not.toContain('raw primary detail');
    await server.close();
  });

  it('returns the friendly 429 and logs both attempts when Gemini 429s both models', async () => {
    const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: 'gemini-fallback-model' });
    // buildTestServer() resets modules, so import AFTER it: the route's `instanceof`
    // check must see the same AssistantRateLimitedError class instance as this test.
    const { AssistantRateLimitedError } = await import('../lib/assistant/model.js');
    mockGenerate
      .mockRejectedValueOnce(new AssistantRateLimitedError('raw primary 429 detail', 429))
      .mockRejectedValueOnce(new AssistantRateLimitedError('raw fallback 429 detail', 429));
    const warnCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, reply, done) => {
      const origWarn = reply.log.warn.bind(reply.log);
      (reply.log as any).warn = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        warnCalls.push([obj, msg]);
        return (origWarn as any)(obj, msg, ...rest);
      };
      done();
    });

    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.json().error.message).toBe('Ask A VUE is busy right now. Try again shortly.');
    expect(JSON.stringify(res.json())).not.toContain('raw primary 429 detail');
    expect(JSON.stringify(res.json())).not.toContain('raw fallback 429 detail');
    expect(mockGenerate).toHaveBeenCalledTimes(2);

    const failures = warnCalls.filter((c) => c[1] === 'assistant_generate_failed');
    expect(failures).toHaveLength(2);
    expect(failures.map((c) => (c[0] as { attempt?: unknown }).attempt)).toEqual(['primary', 'fallback']);
    for (const call of failures) {
      expect(Object.keys(call[0] as Record<string, unknown>).sort()).toEqual([
        'attempt',
        'category',
        'finishReason',
        'latencyMs',
        'model',
        'outcome',
        'statusCode',
      ]);
      expect((call[0] as { statusCode?: unknown }).statusCode).toBe(429);
      expect(JSON.stringify(call)).not.toContain('raw primary 429 detail');
      expect(JSON.stringify(call)).not.toContain('raw fallback 429 detail');
    }
    await server.close();
  });

  it('makes no second call when fallback is not set', async () => {
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    mockGenerate.mockRejectedValueOnce(new AssistantGenerationError('unavailable', { status: 503 }));
    const server = await buildTestServer({ GEMINI_FALLBACK_MODEL: undefined });
    const res = await server.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'How do I book tickets?' } });
    expect(res.statusCode).toBe(502);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('logs failure metadata without message text, history, key, or raw error body', async () => {
    const server = await buildTestServer();
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    mockGenerate.mockRejectedValueOnce(
      new AssistantGenerationError('RAW_PROVIDER_BODY secret-key', {
        status: 503,
        finishReason: 'STOP',
        latencyMs: 123,
      }),
    );
    const warnCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req, _reply, done) => {
      const origWarn = req.log.warn.bind(req.log);
      (req.log as any).warn = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        warnCalls.push([obj, msg]);
        return (origWarn as any)(obj, msg, ...rest);
      };
      done();
    });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'secret user message', history: [{ role: 'user', text: 'secret history' }] },
    });
    expect(res.statusCode).toBe(502);
    const failureLogs = warnCalls.filter((c) => c[1] === 'assistant_generate_failed');
    expect(failureLogs.length).toBeGreaterThan(0);
    for (const call of failureLogs) {
      expect(call[0]).toMatchObject({
        attempt: 'primary',
        model: 'gemini-test-model',
        statusCode: 503,
        finishReason: 'STOP',
      });
      expect((call[0] as { latencyMs?: unknown }).latencyMs).toEqual(expect.any(Number));
      expect(JSON.stringify(call)).not.toContain('secret user message');
      expect(JSON.stringify(call)).not.toContain('secret history');
      expect(JSON.stringify(call)).not.toContain('RAW_PROVIDER_BODY');
      expect(JSON.stringify(call)).not.toContain('test-key');
    }
    await server.close();
  });
});

describe('.env.example assistant entries', () => {
  it('contains Gemini assistant entries with fallback key and updated chat model example', () => {
    const envExamplePath = path.resolve(__dirname, '../../.env.example');
    const content = fs.readFileSync(envExamplePath, 'utf-8');
    expect(content).toContain('GEMINI_API_KEY=');
    expect(content).toMatch(/^GEMINI_API_KEY=\s*$/m);
    expect(content).toContain('GEMINI_CHAT_MODEL=gemini-3.6-flash');
    expect(content).toContain('GEMINI_FALLBACK_MODEL=');
    expect(content).toMatch(/^GEMINI_FALLBACK_MODEL=\s*$/m);
    expect(content).toContain('GEMINI_EMBEDDING_MODEL=gemini-embedding-2');
    expect(content).toContain('EMBEDDING_DIMENSIONS=768');
  });
});

describe('Ask A VUE movie lookup route', () => {
  const mockSearchMovies = vi.fn();
  const mockPoolNowPlaying = vi.fn();
  const mockPoolRankingList = vi.fn();

  function makeMovie(overrides: Record<string, unknown> = {}) {
    return {
      id: 550,
      title: 'Fight Club',
      overview: `${'word '.repeat(80)}tail`,
      releaseDate: '1999-10-15',
      runtimeMinutes: 139,
      genres: ['Drama'],
      voteAverage: 8.4,
      posterPath: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      backdropPath: '/backdrop.jpg',
      ...overrides,
    };
  }

  function captureInfo(server: Awaited<ReturnType<typeof buildTestServer>>) {
    const calls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req: any, _reply: any, done: any) => {
      const orig = req.log.info.bind(req.log);
      req.log.info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        calls.push([obj, msg]);
        return (orig as any)(obj, msg, ...rest);
      };
      done();
    });
    return calls;
  }

  beforeEach(() => {
    mockSearchMovies.mockReset();
    mockSearchMovies.mockResolvedValue({ movies: [], totalResults: 0, stale: false });
    mockPoolNowPlaying.mockReset();
    mockPoolRankingList.mockReset();
    const emptyList = { movies: [], page: 1, totalPages: 0, totalResults: 0, stale: false };
    mockPoolNowPlaying.mockResolvedValue(emptyList);
    mockPoolRankingList.mockResolvedValue(emptyList);
    mockCorrectMovieTitle.mockReset();
    mockCorrectMovieTitle.mockResolvedValue(null);
    mockCorrectedSearch.mockReset();
    mockCorrectedSearch.mockResolvedValue([]);
    vi.doMock('../lib/search.js', async () => {
      const actual = await vi.importActual<any>('../lib/search.js');
      return {
        ...actual,
        searchMovies: (...args: unknown[]) => mockSearchMovies(...args),
      };
    });
    vi.doMock('../lib/titleCorrection.js', () => ({
      correctMovieTitle: (...args: unknown[]) => mockCorrectMovieTitle(...args),
    }));
    // Keep list fallbacks deterministic and offline in route tests.
    vi.doMock('../lib/tmdb.js', async () => {
      const actual = await vi.importActual<any>('../lib/tmdb.js');
      return {
        ...actual,
        getCachedJson: async () => null,
        searchTmdbMovies: (...args: unknown[]) => mockCorrectedSearch(...args),
        getNowPlayingMovies: (...args: unknown[]) => mockPoolNowPlaying(...args),
        getRankingMovieList: (...args: unknown[]) => mockPoolRankingList(...args),
      };
    });
  });

  it('returns the movie field on a match with no Gemini call, even when Gemini is unconfigured', async () => {
    mockSearchMovies.mockResolvedValueOnce({
      movies: [makeMovie({ title: 'Spider-Man: Brand New Day', releaseDate: '2026-01-01' })],
      totalResults: 1,
      stale: false,
    });
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Can I see Spider-Man: Brand New Day poster?' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      reply: 'Here is what I found.',
      movie: {
        tmdbId: 550,
        title: 'Spider-Man: Brand New Day',
        year: '2026',
        posterPath: 'pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      },
    });
    expect((res.json() as any).movie.overview.length).toBeLessThanOrEqual(300);
    expect(mockSearchMovies).toHaveBeenCalledWith('spider man brand new day');
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('returns fixed not-found text for strong intent with no match and no model call', async () => {
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'show me the poster of Dune' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: "I couldn't find that movie. Try the Search screen in A VUE.",
    });
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('falls through to the model for weak intent with no match', async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'what does Lord of the Rings look like' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Hello from A VUE.' });
    expect(mockSearchMovies).toHaveBeenCalledWith('lord of the rings');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0].message).toBe('what does Lord of the Rings look like');
    await server.close();
  });

  it('falls through to the model for weak intent on search error', async () => {
    mockSearchMovies.mockRejectedValueOnce(new Error('SEARCH_UNAVAILABLE'));
    const server = await buildTestServer();
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'what does Dune look like' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Hello from A VUE.' });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0].message).toBe('what does Dune look like');
    await server.close();
  });

  it('returns fixed unavailable text for strong intent on search error with no model call', async () => {
    mockSearchMovies.mockRejectedValueOnce(new Error('SEARCH_UNAVAILABLE'));
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'show me Dune poster' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: 'Movie details are unavailable right now. Try again shortly.',
    });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(JSON.stringify(res.json())).not.toContain('SEARCH_UNAVAILABLE');
    await server.close();
  });

  it('stops ticket questions at the facts gate before search or model', async () => {
    const server = await buildTestServer();
    const { FACTS_REFUSAL_TEXT } = await import('../lib/assistant/factsGate.js');
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Show me my tickets' },
    });

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_TEXT });
    expect(mockSearchMovies).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('logs only verdict and latency for lookup outcomes', async () => {
    // Keyed by search text, not call order: the relaxed retry legitimately calls search
    // twice for a no-result query, so queued one-shot mocks would shift between requests.
    mockSearchMovies.mockImplementation(async (query: string) => {
      if (query === 'dune') {
        return { movies: [makeMovie()], totalResults: 1, stale: false };
      }
      if (query === 'inception') {
        throw new Error('SEARCH_UNAVAILABLE');
      }
      return { movies: [], totalResults: 0, stale: false };
    });
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const infoCalls = captureInfo(server);

    for (const message of [
      'show me Dune poster',
      'show me Avatar poster',
      'show me Inception poster',
    ]) {
      await server.inject({
        method: 'POST',
        url: '/assistant/chat',
        payload: { message },
      });
    }

    const lookupLogs = infoCalls.filter((call) => call[1] === 'assistant_movie_lookup');
    expect(lookupLogs.map((call) => (call[0] as any).verdict)).toEqual([
      'movie-match',
      'movie-none',
      'movie-error',
    ]);
    expect(lookupLogs.map((call) => (call[0] as any).stage)).toEqual(['search', 'none', 'none']);
    for (const call of lookupLogs) {
      expect(Object.keys(call[0] as object).sort()).toEqual(['latencyMs', 'stage', 'verdict']);
      expect((call[0] as any).latencyMs).toEqual(expect.any(Number));
    }
    expect(JSON.stringify(lookupLogs)).not.toContain('Inception');
    expect(JSON.stringify(lookupLogs)).not.toContain('SEARCH_UNAVAILABLE');
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('returns not-found after a failed relaxed retry with one verdict and no model call', async () => {
    let avatarCalls = 0;
    mockSearchMovies.mockImplementation(async (query: string) => {
      if (query === 'avatar') {
        avatarCalls += 1;
        if (avatarCalls === 1) {
          return { movies: [], totalResults: 0, stale: false };
        }
        throw new Error('SEARCH_UNAVAILABLE');
      }
      return { movies: [], totalResults: 0, stale: false };
    });
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const infoCalls = captureInfo(server);

    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'show me Avatar poster' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: "I couldn't find that movie. Try the Search screen in A VUE.",
    });
    expect(avatarCalls).toBe(2); // first search + one relaxed retry
    expect(mockGenerate).not.toHaveBeenCalled();
    const lookupLogs = infoCalls.filter((call) => call[1] === 'assistant_movie_lookup');
    expect(lookupLogs.map((call) => (call[0] as any).verdict)).toEqual(['movie-none']);
    expect(lookupLogs.map((call) => (call[0] as any).stage)).toEqual(['none']);
    await server.close();
  });

  it('rejects a low-score weak match and falls through to the model', async () => {
    mockSearchMovies.mockResolvedValueOnce({
      movies: [makeMovie({ id: 858, title: 'The Lion King' })],
      totalResults: 1,
      stale: false,
    });
    const server = await buildTestServer();
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'what does Dune look like' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Hello from A VUE.' });
    expect(mockSearchMovies).toHaveBeenCalledWith('dune');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('returns the movie for a weak exact title match without a Gemini call', async () => {
    mockSearchMovies.mockResolvedValueOnce({
      movies: [makeMovie({ id: 438, title: 'Dune', releaseDate: '2021-10-01' })],
      totalResults: 1,
      stale: false,
    });
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'tell me about Dune' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      reply: 'Here is what I found.',
      movie: { title: 'Dune', year: '2021' },
    });
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('never searches for generic stoplist titles', async () => {
    const server = await buildTestServer();
    const messages = [
      'Tell me about the cinema',
      'Tell me about A VUE',
      'Tell me about the app',
      'Tell me about you',
      'Tell me about yourself',
      'Tell me about it',
      'Tell me about this',
      'Tell me about that',
      'Tell me about movies',
      'Tell me about films',
      'Tell me about tickets',
    ];

    for (const message of messages) {
      mockSearchMovies.mockClear();
      const res = await server.inject({
        method: 'POST',
        url: '/assistant/chat',
        payload: { message },
      });
      expect(res.statusCode).toBe(200);
      expect(mockSearchMovies).not.toHaveBeenCalled();
    }
    await server.close();
  });

  it('returns not-found for "Can I see spidwr man poster" with no search or pool candidates', async () => {
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Can I see spidwr man poster' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: "I couldn't find that movie. Try the Search screen in A VUE.",
    });
    expect(mockSearchMovies).toHaveBeenCalledWith('spidwr man');
    expect(mockSearchMovies).toHaveBeenCalledTimes(2); // first search + relaxed retry
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('uses the pool stage when a misspelt title has no search candidates', async () => {
    mockPoolRankingList.mockImplementation((name: string) =>
      Promise.resolve({
        movies:
          name === 'popular'
            ? [makeMovie({ id: 3, title: 'Spider-Man: Brand New Day' })]
            : [],
        page: 1,
        totalPages: 1,
        totalResults: name === 'popular' ? 1 : 0,
        stale: false,
      }),
    );
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const infoCalls = captureInfo(server);
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Can I see spidwr man poster' },
    });

    expect(res.json()).toMatchObject({
      reply: 'Here is what I found.',
      movie: { title: 'Spider-Man: Brand New Day' },
    });
    const lookupLogs = infoCalls.filter((call) => call[1] === 'assistant_movie_lookup');
    expect(lookupLogs.map((call) => (call[0] as any).stage)).toEqual(['pool']);
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('resolves a strong-intent typo through the last correction step', async () => {
    mockCorrectMovieTitle.mockResolvedValue('The Sound of Music');
    mockCorrectedSearch.mockResolvedValue([
      makeMovie({ id: 7, title: 'The Sound of Music', releaseDate: '1965-01-01' }),
    ]);
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const infoCalls = captureInfo(server);
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Can I see sund of music poster?' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      reply: 'Here is what I found.',
      movie: { tmdbId: 7, title: 'The Sound of Music' },
    });
    expect(mockCorrectMovieTitle).toHaveBeenCalledWith('sund of music', 'assistant');
    expect(mockCorrectedSearch).toHaveBeenCalledWith('The Sound of Music');
    const lookupLogs = infoCalls.filter((call) => call[1] === 'assistant_movie_lookup');
    expect(lookupLogs.map((call) => (call[0] as any).stage)).toEqual(['corrected']);
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('keeps the existing not-found reply when correction returns null', async () => {
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Can I see sund of music poster?' },
    });

    expect(res.json()).toEqual({
      reply: "I couldn't find that movie. Try the Search screen in A VUE.",
    });
    expect(mockCorrectMovieTitle).toHaveBeenCalledTimes(1);
    expect(mockCorrectedSearch).not.toHaveBeenCalled();
    await server.close();
  });

  it('never runs correction for weak or non-movie messages', async () => {
    const server = await buildTestServer();
    const weak = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'what does Dune look like' },
    });
    const other = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How do I book tickets?' },
    });

    expect(weak.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    expect(mockCorrectMovieTitle).not.toHaveBeenCalled();
    await server.close();
  });

  it('adds the year hint when two near-tie results remain', async () => {
    mockSearchMovies.mockResolvedValueOnce({
      movies: [
        makeMovie({ id: 1, title: 'Superman', releaseDate: '2025-07-11' }),
        makeMovie({ id: 2, title: 'SUPERMAN', releaseDate: '2025-07-11' }),
      ],
      totalResults: 2,
      stale: false,
    });
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'show me Superman poster' },
    });

    expect(res.json()).toMatchObject({
      reply: 'Here is what I found. You can add the year to narrow it down.',
      movie: { title: 'Superman' },
    });
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('uses pool popularity so a bare title does not pick an older low-popularity match', async () => {
    mockSearchMovies.mockResolvedValueOnce({
      movies: [
        makeMovie({ id: 1, title: 'Superman', releaseDate: '1991-01-01' }),
        makeMovie({ id: 2, title: 'Superman', releaseDate: '2025-07-11' }),
      ],
      totalResults: 2,
      stale: false,
    });
    mockPoolRankingList.mockImplementation((name: string) =>
      Promise.resolve({
        movies:
          name === 'popular'
            ? [
                makeMovie({
                  id: 2,
                  title: 'Superman',
                  releaseDate: '2025-07-11',
                  popularityScore: 5000,
                  voteCount: 10000,
                }),
              ]
            : [],
        page: 1,
        totalPages: 1,
        totalResults: name === 'popular' ? 1 : 0,
        stale: false,
      }),
    );
    const server = await buildTestServer({ GEMINI_API_KEY: undefined });
    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'show me Superman poster' },
    });

    expect(res.json()).toMatchObject({ movie: { tmdbId: 2, title: 'Superman' } });
    expect(mockGenerate).not.toHaveBeenCalled();
    await server.close();
  });

  it('scores weak matches with the real search helper', () => {
    const routeSrc = fs.readFileSync(path.resolve(__dirname, '../routes/assistant.ts'), 'utf-8');
    expect(routeSrc).toContain('calculateSearchScore, normalizeSearchText, searchMovies');
    expect(routeSrc).toContain(
      'calculateSearchScore(query, movie.title) >= WEAK_MATCH_MIN_SCORE',
    );
  });
});

describe('C6 — failed-attempt log category', () => {
  it('maps status and error class to the closed category set', async () => {
    const model = await import('../lib/assistant/model.js');
    const cases: Array<[string, unknown, string | undefined, string]> = [
      ['missing key', new model.AssistantNotConfiguredError('RAW_KEY_DETAIL'), undefined, 'auth'],
      ['401 status', new model.AssistantGenerationError('RAW_401_DETAIL', { status: 401 }), undefined, 'auth'],
      ['403 status', new model.AssistantGenerationError('RAW_403_DETAIL', { status: 403 }), undefined, 'auth'],
      ['quota class', new model.AssistantRateLimitedError('RAW_QUOTA_DETAIL', 429), undefined, 'quota'],
      ['429 status', new model.AssistantGenerationError('RAW_429_DETAIL', { status: 429 }), undefined, 'quota'],
      ['404 status', new model.AssistantGenerationError('RAW_404_DETAIL', { status: 404 }), undefined, 'not_found'],
      ['400 status', new model.AssistantGenerationError('RAW_400_DETAIL', { status: 400 }), undefined, 'bad_request'],
      ['timeout class', new model.AssistantTimeoutError('RAW_TIMEOUT_DETAIL'), undefined, 'timeout'],
      ['504 status', new model.AssistantGenerationError('RAW_504_DETAIL', { status: 504 }), undefined, 'timeout'],
      ['abort class', Object.assign(new Error('RAW_ABORT_DETAIL'), { name: 'AbortError' }), undefined, 'timeout'],
      ['blocked finish reason', new model.AssistantGenerationError('empty_or_blocked', { finishReason: 'SAFETY' }), 'SAFETY', 'blocked'],
      ['5xx status', new model.AssistantGenerationError('RAW_503_DETAIL', { status: 503 }), undefined, 'network'],
      ['network class', Object.assign(new Error('RAW_FETCH_DETAIL'), { name: 'FetchError' }), undefined, 'network'],
      ['other', new model.AssistantGenerationError('RAW_OTHER_DETAIL'), undefined, 'other'],
    ];
    expect(new Set(cases.map((c) => c[3])).size).toBe(8);
    for (const [label, err, finishReason, expected] of cases) {
      expect(model.assistantErrorCategory(err, finishReason), label).toBe(expected);
    }
    // Message text alone never drives the category or leaks into the log field.
    expect(model.assistantErrorCategory(new Error('quota secret 401 not found'))).toBe('other');
  });

  it('adds only a closed-set category field to the failed-attempt log line', async () => {
    const server = await buildTestServer();
    const { AssistantGenerationError } = await import('../lib/assistant/model.js');
    mockGenerate.mockRejectedValueOnce(
      new AssistantGenerationError('RAW_PROVIDER_BODY secret', { status: 503, finishReason: 'STOP' }),
    );
    const warnCalls: Array<[unknown, unknown]> = [];
    server.addHook('onRequest', (req: any, _reply: any, done: any) => {
      const orig = req.log.warn.bind(req.log);
      req.log.warn = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
        warnCalls.push([obj, msg]);
        return (orig as any)(obj, msg, ...rest);
      };
      done();
    });

    const res = await server.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How do I book tickets?' },
    });
    expect(res.statusCode).toBe(502);
    const failures = warnCalls.filter((call) => call[1] === 'assistant_generate_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0][0]).toMatchObject({ category: 'network', statusCode: 503, outcome: 'failed' });
    expect([
      'auth', 'quota', 'not_found', 'bad_request', 'network', 'timeout', 'blocked', 'other',
    ]).toContain((failures[0][0] as { category?: string }).category);
    expect(JSON.stringify(failures[0])).not.toContain('RAW_PROVIDER_BODY');
    expect(JSON.stringify(failures[0])).not.toContain('secret');
    await server.close();
  });
});
