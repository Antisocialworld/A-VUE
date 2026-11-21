import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_DEADLINE_REPLY } from '../lib/assistant/systemPrompt.js';

const STALL_REQUEST_DEADLINE_MS = 400;
const STALL_MIN_MODEL_BUDGET_MS = 50;
const BUDGET_REQUEST_DEADLINE_MS = 6000;
const BUDGET_MIN_MODEL_BUDGET_MS = 3000;
const CONFIGURED_MODEL_CLAMP_MS = 15000;
const TEST_TIMEOUT_MS = 10000;

const deadlineState = vi.hoisted(() => ({
  requestMs: 24000,
  minMs: 3000,
}));

vi.mock('../lib/assistant/deadline.js', () => ({
  get ASSISTANT_REQUEST_DEADLINE_MS() {
    return deadlineState.requestMs;
  },
  get MIN_MODEL_BUDGET_MS() {
    return deadlineState.minMs;
  },
}));

const mockGenerate = vi.fn();
const mockRunAssistantToolFlow = vi.fn();
const mockRetrieveFactChunks = vi.fn();
const mockLogRagRetrieval = vi.fn();
const mockReadCinemaPriceRanges = vi.fn();
const mockReadUpcomingShowtimes = vi.fn();
const mockGetCachedJson = vi.fn();
const mockSetCachedJson = vi.fn();
const mockAssistantRateLimit = vi.fn();
const mockSearchRateLimit = vi.fn();
const mockGetSessionUser = vi.fn();
const mockSearchMovies = vi.fn();

const baseEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '0.0.0.0',
  TRUST_PROXY: false,
  REQUEST_TIMEOUT_MS: 10000,
  BODY_LIMIT_KB: 100,
  GEMINI_API_KEY: 'test-key',
  GEMINI_CHAT_MODEL: 'gemini-test-model',
  GEMINI_ATTEMPT_TIMEOUT_MS: CONFIGURED_MODEL_CLAMP_MS,
};

let activeApps: any[] = [];
let releaseStalledWork: Array<() => void> = [];

function releaseAllStalledWork(): void {
  const releases = releaseStalledWork.splice(0);
  for (const release of releases) release();
}

function waitForSettledWork(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function resetMocks(): void {
  releaseStalledWork = [];

  mockGenerate.mockReset().mockResolvedValue('Fast answer.');
  mockRunAssistantToolFlow.mockReset().mockResolvedValue({ used: false, outcome: 'skipped' });
  mockRetrieveFactChunks.mockReset().mockResolvedValue([]);
  mockLogRagRetrieval.mockReset();
  mockReadCinemaPriceRanges.mockReset().mockResolvedValue([]);
  mockReadUpcomingShowtimes.mockReset().mockResolvedValue([]);
  mockGetCachedJson.mockReset().mockResolvedValue(null);
  mockSetCachedJson.mockReset().mockResolvedValue(undefined);
  mockAssistantRateLimit.mockReset().mockResolvedValue(true);
  mockSearchRateLimit.mockReset().mockResolvedValue(true);
  mockGetSessionUser.mockReset().mockResolvedValue({
    id: 'user-123',
    email: 'user@example.com',
    status: 'active',
  });
  mockSearchMovies.mockReset().mockResolvedValue({ movies: [] });
}

function stallGenerateOnce(): void {
  mockGenerate.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        releaseStalledWork.push(() => resolve('Late answer.'));
      }),
  );
}

function stallUpcomingShowtimesOnce(): void {
  mockReadUpcomingShowtimes.mockImplementationOnce(
    () =>
      new Promise<unknown[]>((resolve) => {
        releaseStalledWork.push(() => resolve([]));
      }),
  );
}

async function buildRouteServer(): Promise<any> {
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
  vi.doMock('../lib/assistant/toolUse.js', async () => {
    const actual = await vi.importActual<any>('../lib/assistant/toolUse.js');
    return { ...actual, runAssistantToolFlow: (...args: unknown[]) => mockRunAssistantToolFlow(...args) };
  });
  vi.doMock('../lib/rag/retrieve.js', async () => {
    const actual = await vi.importActual<any>('../lib/rag/retrieve.js');
    return {
      ...actual,
      retrieveFactChunks: (...args: unknown[]) => mockRetrieveFactChunks(...args),
      logRagRetrieval: (...args: unknown[]) => mockLogRagRetrieval(...args),
    };
  });
  vi.doMock('../lib/assistant/liveFacts.js', async () => {
    const actual = await vi.importActual<any>('../lib/assistant/liveFacts.js');
    return {
      ...actual,
      readCinemaPriceRanges: (...args: unknown[]) => mockReadCinemaPriceRanges(...args),
      readUpcomingShowtimes: (...args: unknown[]) => mockReadUpcomingShowtimes(...args),
    };
  });
  vi.doMock('../lib/tmdb.js', async () => {
    const actual = await vi.importActual<any>('../lib/tmdb.js');
    return {
      ...actual,
      getCachedJson: (...args: unknown[]) => mockGetCachedJson(...args),
      setCachedJson: (...args: unknown[]) => mockSetCachedJson(...args),
    };
  });
  vi.doMock('../lib/search.js', async () => {
    const actual = await vi.importActual<any>('../lib/search.js');
    return {
      ...actual,
      searchMovies: (...args: unknown[]) => mockSearchMovies(...args),
    };
  });
  vi.doMock('../lib/assistant/movieLookup.js', async () => {
    const actual = await vi.importActual<any>('../lib/assistant/movieLookup.js');
    return {
      ...actual,
      extractMovieTitle: () => 'Avatar',
      isSearchableMovieTitle: () => true,
      extractLookupHints: () => ({}),
      buildLookupQuery: () => 'Avatar',
      enrichWithPoolSignals: async (movies: unknown[]) => movies,
      rankCandidates: () => ({
        movie: { id: 1, title: 'Avatar', year: '2009', overview: '', posterPath: null },
        uncertain: false,
      }),
      findRelaxedMovie: async () => null,
      findCachedMovie: async () => null,
      findPooledMovie: async () => null,
      findCorrectedMovie: async () => null,
    };
  });
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
  const app = await buildServer();
  activeApps.push(app);
  const infoCalls: Array<[unknown, unknown]> = [];
  let sendCount = 0;
  app.addHook('onRequest', (req: any, reply: any, done: () => void) => {
    const originalInfo = req.log.info.bind(req.log);
    req.log.info = (obj: unknown, msg?: unknown, ...rest: unknown[]) => {
      infoCalls.push([obj, msg]);
      return (originalInfo as any)(obj, msg, ...rest);
    };
    const originalSend = reply.send.bind(reply);
    reply.send = (...args: unknown[]) => {
      sendCount += 1;
      return (originalSend as any)(...args);
    };
    done();
  });
  return { app, infoCalls, getSendCount: () => sendCount };
}

function deadlineLogs(infoCalls: Array<[unknown, unknown]>): unknown[] {
  return infoCalls
    .map(([obj]) => obj)
    .filter(
      (obj): obj is Record<string, unknown> =>
        Boolean(
          obj &&
            typeof obj === 'object' &&
            (obj as Record<string, unknown>).verdict === 'assistant-deadline',
        ),
    );
}

beforeEach(() => {
  deadlineState.requestMs = 24000;
  deadlineState.minMs = 3000;
  activeApps = [];
  resetMocks();
});

afterEach(async () => {
  releaseAllStalledWork();
  await waitForSettledWork();
  for (const app of activeApps) await app.close();
  activeApps = [];
});

describe('assistant request deadline', () => {
  it('returns the deterministic 200 reply when the model stalls', async () => {
    deadlineState.requestMs = STALL_REQUEST_DEADLINE_MS;
    deadlineState.minMs = STALL_MIN_MODEL_BUDGET_MS;
    const { app, infoCalls, getSendCount } = await buildRouteServer();
    stallGenerateOnce();

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How long are seats held?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reply: ASSISTANT_DEADLINE_REPLY });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockSetCachedJson).not.toHaveBeenCalled();
    expect(deadlineLogs(infoCalls)).toEqual([
      { verdict: 'assistant-deadline', path: 'generate' },
    ]);
    expect(getSendCount()).toBe(1);

    releaseAllStalledWork();
    await waitForSettledWork();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(getSendCount()).toBe(1);
  }, TEST_TIMEOUT_MS);

  it('returns the deterministic 200 reply when live showtimes stall', async () => {
    deadlineState.requestMs = STALL_REQUEST_DEADLINE_MS;
    deadlineState.minMs = STALL_MIN_MODEL_BUDGET_MS;
    const { app, infoCalls, getSendCount } = await buildRouteServer();
    stallUpcomingShowtimesOnce();

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'what time is Avatar showing' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reply: ASSISTANT_DEADLINE_REPLY });
    expect(mockReadUpcomingShowtimes).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockSetCachedJson).not.toHaveBeenCalled();
    expect(deadlineLogs(infoCalls)).toEqual([
      { verdict: 'assistant-deadline', path: 'live-facts' },
    ]);
    expect(getSendCount()).toBe(1);

    releaseAllStalledWork();
    await waitForSettledWork();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(getSendCount()).toBe(1);
  }, TEST_TIMEOUT_MS);

  it('leaves a fast request unchanged', async () => {
    const { app, infoCalls } = await buildRouteServer();

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How long are seats held?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reply: 'Fast answer.' });
    expect(deadlineLogs(infoCalls)).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it('gives generate the smaller of its configured clamp and the remaining request budget', async () => {
    deadlineState.requestMs = BUDGET_REQUEST_DEADLINE_MS;
    deadlineState.minMs = BUDGET_MIN_MODEL_BUDGET_MS;
    const { app } = await buildRouteServer();

    const response = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      payload: { message: 'How long are seats held?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reply: 'Fast answer.' });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const generationArgs = mockGenerate.mock.calls[0][0];
    expect(generationArgs.timeoutMs).toBeLessThanOrEqual(BUDGET_REQUEST_DEADLINE_MS);
    expect(generationArgs.timeoutMs).toBeLessThan(CONFIGURED_MODEL_CLAMP_MS);
    expect(generationArgs.timeoutMs).toBeGreaterThanOrEqual(BUDGET_MIN_MODEL_BUDGET_MS);
    expect(generationArgs.signal).toBeDefined();
  }, TEST_TIMEOUT_MS);
});
