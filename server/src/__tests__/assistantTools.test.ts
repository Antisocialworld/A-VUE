import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateTurn = vi.fn();
const mockGenerate = vi.fn();
const mockGetCachedJson = vi.fn();
const mockSetCachedJson = vi.fn();
const mockSearchPeople = vi.fn();
const mockPersonCredits = vi.fn();
const mockSearchRateLimit = vi.fn();
const mockAssistantRateLimit = vi.fn();
const mockGetSessionUser = vi.fn();
const mockRunAssistantToolFlow = vi.fn();

const baseEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '0.0.0.0',
  TRUST_PROXY: false,
  REQUEST_TIMEOUT_MS: 10000,
  BODY_LIMIT_KB: 100,
  GEMINI_API_KEY: 'test-key',
  GEMINI_CHAT_MODEL: 'gemini-test-model',
  GEMINI_ATTEMPT_TIMEOUT_MS: 10000,
};

const logs: string[] = [];
let originalWrite: typeof process.stdout.write;

const toolCall = (name = 'lookup_person', value = 'Jet Li') => ({
  name,
  args: { name: value },
});

function resetMocks(): void {
  mockGenerateTurn.mockReset();
  mockGenerate.mockReset();
  mockGetCachedJson.mockReset().mockResolvedValue(null);
  mockSetCachedJson.mockReset().mockResolvedValue(undefined);
  mockSearchPeople.mockReset().mockResolvedValue([]);
  mockPersonCredits.mockReset().mockResolvedValue([]);
  mockSearchRateLimit.mockReset().mockResolvedValue(true);
  mockAssistantRateLimit.mockReset().mockResolvedValue(true);
  mockGetSessionUser.mockReset().mockResolvedValue({
    id: 'user-123',
    email: 'user@example.com',
    status: 'active',
  });
  mockRunAssistantToolFlow.mockReset().mockResolvedValue({ used: false, outcome: 'skipped' });
  logs.length = 0;
}

beforeEach(() => {
  resetMocks();
  originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    logs.push(String(chunk));
    return originalWrite.call(process.stdout, chunk, ...args);
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

async function loadToolUse() {
  vi.resetModules();
  vi.doMock('../env.js', () => ({ env: baseEnv }));
  vi.doMock('../lib/assistant/model.js', async () => {
    const actual = await vi.importActual<any>('../lib/assistant/model.js');
    return { ...actual, generateTurn: (...args: unknown[]) => mockGenerateTurn(...args) };
  });
  vi.doMock('../lib/tmdb.js', () => ({
    getCachedJson: (...args: unknown[]) => mockGetCachedJson(...args),
    setCachedJson: (...args: unknown[]) => mockSetCachedJson(...args),
    searchTmdbPeople: (...args: unknown[]) => mockSearchPeople(...args),
    getTmdbPersonMovieCredits: (...args: unknown[]) => mockPersonCredits(...args),
  }));
  vi.doMock('../lib/rateLimit.js', () => ({
    searchRateLimit: (...args: unknown[]) => mockSearchRateLimit(...args),
  }));
  return await import('../lib/assistant/toolUse.js');
}

function flowInput(message = 'Who is Jet Li?') {
  return {
    system: 'system',
    history: [],
    message,
    model: 'gemini-test-model',
    timeoutMs: 10000,
  };
}

async function buildRouteServer() {
  vi.resetModules();
  vi.doMock('../env.js', () => ({
    env: baseEnv,
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
      searchRateLimit: (...args: unknown[]) => mockSearchRateLimit(...args),
    };
  });
  vi.doMock('../lib/assistant/model.js', async () => {
    const actual = await vi.importActual<any>('../lib/assistant/model.js');
    return { ...actual, generate: (...args: unknown[]) => mockGenerate(...args) };
  });
  vi.doMock('../lib/assistant/toolUse.js', () => ({
    runAssistantToolFlow: (...args: unknown[]) => mockRunAssistantToolFlow(...args),
  }));
  vi.doMock('../routes/health.js', () => ({ healthRoutes: async () => {} }));
  vi.doMock('../routes/dev.js', () => ({ devRoutes: async () => {} }));
  vi.doMock('../routes/auth.js', () => ({ authRoutes: async () => {} }));
  vi.doMock('../routes/movies.js', () => ({ movieRoutes: async () => {} }));
  vi.doMock('../routes/showtimes.js', () => ({ showtimeRoutes: async () => {} }));
  vi.doMock('../routes/checkout.js', () => ({ checkoutRoutes: async () => {} }));
  vi.doMock('../routes/webhooks.js', () => ({ webhookRoutes: async () => {} }));
  vi.doMock('../routes/tickets.js', () => ({ ticketRoutes: async () => {} }));
  vi.doMock('../routes/cron.js', () => ({ cronRoutes: async () => {} }));
  const { buildServer } = await import('../server.js');
  return buildServer();
}

describe('T1: closed tool set', () => {
  it('offers exactly the two declared tools on a person question', async () => {
    const tu = await loadToolUse();
    expect(tu.TOOL_NAMES).toEqual(['lookup_person', 'lookup_movie_credits']);
    expect(tu.TOOL_DECLARATIONS.map((tool: { name: string }) => tool.name)).toEqual(tu.TOOL_NAMES);
    expect(tu.isToolEligibleMessage('Who is Jet Li?')).toBe(true);
    // "that film" names no person, and "directed" is not a gate term; lookup_movie_credits
    // needs a person name, so the tool path is correctly not offered here.
    expect(tu.isToolEligibleMessage('Who directed that film?')).toBe(false);
    // Both phrasings already match the existing gate and name a person.
    expect(tu.isToolEligibleMessage('What is Jet Li known for?')).toBe(true);
    expect(tu.isToolEligibleMessage('Jet Li filmography')).toBe(true);
  });

  it('does not offer tools on non-movie/person paths', async () => {
    const tu = await loadToolUse();
    expect(tu.isToolEligibleMessage('How do I book a ticket?')).toBe(false);
    expect(tu.isToolEligibleMessage('What are your opening hours?')).toBe(false);
    expect(tu.isToolEligibleMessage('')).toBe(false);

    const result = await tu.runAssistantToolFlow(flowInput('How do I book a ticket?'));
    expect(result).toEqual({ used: false, outcome: 'skipped' });
    expect(mockGenerateTurn).not.toHaveBeenCalled();
    expect(mockSearchRateLimit).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('accepts typo-tolerant names unchanged', async () => {
    const tu = await loadToolUse();
    expect(tu.isValidToolInput('jetli')).toBe(true);
    expect(tu.isValidToolInput('jet lee')).toBe(true);
    expect(tu.isValidToolInput('Li')).toBe(true);

    for (const typed of ['jetli', 'jet lee']) {
      resetMocks();
      mockGenerateTurn
        .mockResolvedValueOnce({ text: '', toolCalls: [toolCall('lookup_person', typed)] })
        .mockResolvedValueOnce({ text: 'Answer.', toolCalls: [] });
      mockSearchPeople.mockResolvedValue([{ id: 7, name: 'Jet Li', department: 'Acting' }]);

      const result = await tu.runAssistantToolFlow(flowInput(`Who is ${typed}?`));
      expect(result.outcome).toBe('ok');
      // No correction step: the validated name is sent verbatim to the TMDB adapter.
      expect(mockSearchPeople).toHaveBeenCalledWith(typed);
    }
  });
});

describe('T1: tool-call-then-answer and fallbacks', () => {
  it('runs one tool call then answers, with attribution and structured-only response', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] })
      .mockResolvedValueOnce({ text: 'Jet Li is a martial artist.', toolCalls: [] });
    mockSearchPeople.mockResolvedValue([{ id: 1, name: 'Jet Li', department: 'Acting' }]);

    const result = await tu.runAssistantToolFlow(flowInput());

    expect(result.outcome).toBe('ok');
    expect(result.text).toContain('Jet Li is a martial artist.');
    expect(result.text).toContain(tu.TMDB_TOOL_ATTRIBUTION_TEXT);
    expect(mockGenerateTurn).toHaveBeenCalledTimes(2);

    const first = mockGenerateTurn.mock.calls[0][0];
    expect(first.tools).toEqual(tu.TOOL_DECLARATIONS);
    const second = mockGenerateTurn.mock.calls[1][0];
    expect(second.tools).toBeUndefined();
    expect(second.priorToolCalls).toEqual([toolCall()]);
    expect(second.toolResponses[0].response).toEqual({
      found: true,
      items: [{ id: 1, name: 'Jet Li', department: 'Acting' }],
    });
  });

  it('rejects junk args with no TMDB call and no cache write', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockResolvedValueOnce({
      text: '',
      toolCalls: [toolCall('lookup_person', 'user@example.com')],
    });

    const result = await tu.runAssistantToolFlow(flowInput('Who is user@example.com?'));

    expect(result.outcome).toBe('invalid');
    expect(mockSearchPeople).not.toHaveBeenCalled();
    expect(mockPersonCredits).not.toHaveBeenCalled();
    expect(mockSetCachedJson).not.toHaveBeenCalled();
    expect(logs.join(' ')).toContain('"outcome":"invalid"');
  });

  it('rejects an unknown tool name without calling TMDB', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockResolvedValueOnce({
      text: '',
      toolCalls: [{ name: 'read_user_email', args: { name: 'Jet Li' } }],
    });
    const result = await tu.runAssistantToolFlow(flowInput());
    expect(result.outcome).toBe('invalid');
    expect(mockSearchPeople).not.toHaveBeenCalled();
  });

  it('caps the round at two calls', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockResolvedValueOnce({
      text: '',
      toolCalls: [toolCall(), toolCall('lookup_movie_credits'), toolCall()],
    });

    const result = await tu.runAssistantToolFlow(flowInput());

    expect(result.outcome).toBe('skipped');
    expect(mockSearchPeople).not.toHaveBeenCalled();
    expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
  });

  it('allows no second tool round', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] })
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] });
    mockSearchPeople.mockResolvedValue([{ id: 1, name: 'Jet Li', department: 'Acting' }]);

    const result = await tu.runAssistantToolFlow(flowInput());

    expect(result.outcome).toBe('skipped');
    expect(mockGenerateTurn).toHaveBeenCalledTimes(2);
    expect(result.text).toBeUndefined();
  });

  it('falls back without throwing when the model fails or times out', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockRejectedValueOnce(new Error('DEADLINE_EXCEEDED'));

    await expect(tu.runAssistantToolFlow(flowInput())).resolves.toMatchObject({
      used: true,
      outcome: 'error',
    });
  });

  it('falls back without caching when a TMDB lookup fails', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] });
    mockSearchPeople.mockRejectedValueOnce(new Error('TMDB_UNAVAILABLE'));

    const result = await tu.runAssistantToolFlow(flowInput());

    expect(result.outcome).toBe('error');
    expect(mockSetCachedJson).not.toHaveBeenCalled();
    expect(result.text).toBeUndefined();
  });

  it('falls back on no-match', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] });
    mockSearchPeople.mockResolvedValue([]);

    const result = await tu.runAssistantToolFlow(flowInput('Who is Zzzqq Notaperson?'));

    expect(result.outcome).toBe('none');
    expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
  });
});

describe('T1: shaping, caching and logging', () => {
  it('caps results at eight structured items and carries no biography or overview', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] })
      .mockResolvedValueOnce({ text: 'Answer.', toolCalls: [] });
    mockSearchPeople.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        name: `Person ${index}`,
        department: 'Acting',
        biography: 'private free text that must not leave the adapter',
      })),
    );

    await tu.runAssistantToolFlow(flowInput());

    const response = mockGenerateTurn.mock.calls[1][0].toolResponses[0].response;
    expect(response.items).toHaveLength(8);
    for (const item of response.items) {
      expect(Object.keys(item).sort()).toEqual(['department', 'id', 'name']);
    }
    expect(JSON.stringify(response)).not.toContain('biography');
    expect(JSON.stringify(response)).not.toContain('overview');
  });

  it('caps movie credits at eight structured items', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall('lookup_movie_credits')] })
      .mockResolvedValueOnce({ text: 'Answer.', toolCalls: [] });
    mockSearchPeople.mockResolvedValue([{ id: 1, name: 'Jet Li', department: 'Acting' }]);
    mockPersonCredits.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        id: index + 1,
        title: `Movie ${index}`,
        year: '2001',
        role: 'Lead',
        department: 'Acting',
        overview: 'must not be forwarded',
      })),
    );

    await tu.runAssistantToolFlow(flowInput());

    const response = mockGenerateTurn.mock.calls[1][0].toolResponses[0].response;
    expect(response.items).toHaveLength(8);
    expect(Object.keys(response.items[0]).sort()).toEqual([
      'department',
      'id',
      'role',
      'title',
      'year',
    ]);
    expect(JSON.stringify(response)).not.toContain('overview');
  });

  it('uses a cache hit before the rate limiter and TMDB', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] })
      .mockResolvedValueOnce({ text: 'Answer.', toolCalls: [] });
    mockGetCachedJson.mockResolvedValue({
      items: [{ id: 9, name: 'Cached Person', department: 'Acting' }],
      empty: false,
    });

    const result = await tu.runAssistantToolFlow(flowInput());

    expect(result.outcome).toBe('ok');
    expect(mockSearchRateLimit).not.toHaveBeenCalled();
    expect(mockSearchPeople).not.toHaveBeenCalled();
    expect(mockSetCachedJson).not.toHaveBeenCalled();
  });

  it('writes only real outcomes to the cache', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn.mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] });
    mockSearchPeople.mockResolvedValue([]);

    await tu.runAssistantToolFlow(flowInput('Who is Zzzqq Notaperson?'));

    expect(mockSetCachedJson).toHaveBeenCalledTimes(1);
    const written = mockSetCachedJson.mock.calls[0];
    expect(written[1]).toEqual({ items: [], empty: true });
    expect(written[2]).toBe(300);
    expect(written[0]).toMatch(/^assistant-tool:[0-9a-f]{64}$/);
  });

  it('logs only the closed verdict/tool/outcome set', async () => {
    const tu = await loadToolUse();
    mockGenerateTurn
      .mockResolvedValueOnce({ text: '', toolCalls: [toolCall()] })
      .mockResolvedValueOnce({ text: 'Jet Li is an actor.', toolCalls: [] });
    mockSearchPeople.mockResolvedValue([{ id: 1, name: 'Jet Li', department: 'Acting' }]);

    await tu.runAssistantToolFlow(flowInput());

    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed).sort()).toEqual(['outcome', 'tool', 'verdict']);
      expect(parsed.verdict).toBe('tool-use');
      expect(['lookup_person', 'lookup_movie_credits', 'none']).toContain(parsed.tool);
      expect(['ok', 'none', 'invalid', 'error', 'skipped']).toContain(parsed.outcome);
    }
    const combined = logs.join(' ');
    for (const secret of [
      'user-123',
      'user@example.com',
      'test-key',
      'Jet Li',
      'Who is Jet Li?',
      'martial artist',
      'department',
    ]) {
      expect(combined).not.toContain(secret);
    }
  });
});

describe('T1: route integration', () => {
  it('returns a tool answer with 200', async () => {
    const app = await buildRouteServer();
    mockRunAssistantToolFlow.mockResolvedValueOnce({
      used: true,
      outcome: 'ok',
      text: 'Tool answer.\n\nThis application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Who is Jet Li?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain('Tool answer.');
    expect(mockGenerate).not.toHaveBeenCalled();
  }, 20000);

  it('falls back to the non-tool answer with no 5xx when tools fail', async () => {
    const app = await buildRouteServer();
    mockRunAssistantToolFlow.mockResolvedValueOnce({ used: true, outcome: 'error' });
    mockGenerate.mockResolvedValueOnce('Plain model answer.');

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Who is Jet Li?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toBe('Plain model answer.');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  }, 20000);

  it('never asks for tools on a greeting path', async () => {
    const app = await buildRouteServer();

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRunAssistantToolFlow).not.toHaveBeenCalled();
  }, 20000);
});
