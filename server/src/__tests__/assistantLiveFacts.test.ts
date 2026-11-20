import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readerQuery: vi.fn(),
  generate: vi.fn(),
  searchMovies: vi.fn(),
  getSessionUser: vi.fn(),
  assistantRateLimit: vi.fn(),
}));

vi.mock('../lib/db.js', () => ({
  writerPool: { query: vi.fn() },
  readerPool: { query: (...args: unknown[]) => mocks.readerQuery(...args) },
}));

vi.mock('../env.js', () => ({
  env: {
    NODE_ENV: 'test',
    GEMINI_API_KEY: 'test-key',
    GEMINI_CHAT_MODEL: 'gemini-test-model',
    GEMINI_FALLBACK_MODEL: undefined,
    GEMINI_ATTEMPT_TIMEOUT_MS: 8000,
  },
  isAdmin: () => false,
  getTmdbToken: () => undefined,
  getSearchCacheTtlSeconds: () => 600,
}));

vi.mock('../lib/session.js', () => ({
  getSessionUser: (...args: unknown[]) => mocks.getSessionUser(...args),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('../lib/rateLimit.js', () => ({
  assistantRateLimit: (...args: unknown[]) => mocks.assistantRateLimit(...args),
}));

vi.mock('../lib/assistant/model.js', async () => {
  const actual = await vi.importActual<any>('../lib/assistant/model.js');
  return { ...actual, generate: (...args: unknown[]) => mocks.generate(...args) };
});

vi.mock('../lib/search.js', async () => {
  const actual = await vi.importActual<any>('../lib/search.js');
  return { ...actual, searchMovies: (...args: unknown[]) => mocks.searchMovies(...args) };
});

vi.mock('../lib/tmdb.js', async () => {
  const actual = await vi.importActual<any>('../lib/tmdb.js');
  const emptyList = { movies: [], page: 1, totalPages: 0, totalResults: 0, stale: false };
  return {
    ...actual,
    getCachedJson: async () => null,
    getNowPlayingMovies: async () => emptyList,
    getRankingMovieList: async () => emptyList,
  };
});

import {
  FACTS_REFUSAL_PRICE_TEXT,
  FACTS_REFUSAL_SHOWTIMES_TEXT,
  factsRefusalText,
} from '../lib/assistant/factsGate.js';
import { formatKoboToNaira, LIVE_FACTS_TIMEOUT_MS } from '../lib/assistant/liveFacts.js';
import { assistantRoutes } from '../routes/assistant.js';

type TestServer = Awaited<ReturnType<typeof buildAssistantServer>>;

async function buildAssistantServer(logLines: string[]) {
  const app = Fastify({
    logger: {
      level: 'info',
      stream: {
        write: (line: string) => {
          logLines.push(line);
        },
      },
    },
  });
  await app.register(assistantRoutes);
  return app;
}

function post(app: TestServer, message: string) {
  return app.inject({ method: 'POST', url: '/assistant/chat', payload: { message } });
}

function liveLogs(logLines: string[]): any[] {
  return logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.msg === 'assistant_live_facts');
}

function makeMovie(title: string, id = 550) {
  return {
    id,
    title,
    overview: 'A short synopsis.',
    releaseDate: '2009-12-18',
    runtimeMinutes: 162,
    genres: ['Action'],
    voteAverage: 8.4,
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
  };
}

describe('assistant live facts', () => {
  beforeEach(() => {
    mocks.readerQuery.mockReset();
    mocks.generate.mockReset();
    mocks.searchMovies.mockReset();
    mocks.getSessionUser.mockReset();
    mocks.assistantRateLimit.mockReset();
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1' });
    mocks.assistantRateLimit.mockResolvedValue(true);
    mocks.generate.mockResolvedValue('Model reply');
    mocks.searchMovies.mockResolvedValue({ movies: [], totalResults: 0, stale: false });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('formats integer kobo as naira with no fractional naira and no float maths', () => {
    expect(formatKoboToNaira(450000)).toBe('₦4,500');
    expect(formatKoboToNaira(450050)).toBe('₦4,500.50');
    expect(formatKoboToNaira(105)).toBe('₦1.05');
    expect(formatKoboToNaira(5)).toBe('₦0.05');
    expect(formatKoboToNaira(0)).toBe('₦0');
  });

  it('answers a price question from the database without calling the model', async () => {
    mocks.readerQuery.mockResolvedValue({
      rows: [
        { cinema_name: 'VI Grand', low_kobo: '150000', high_kobo: '150000' },
        { cinema_name: 'Ikeja Main', low_kobo: '120000', high_kobo: '200050' },
      ],
    });
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'How much is a ticket?');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply:
        'Tickets at VI Grand are ₦1,500.\nTickets at Ikeja Main are from ₦1,200 to ₦2,000.50.',
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    const [config] = mocks.readerQuery.mock.calls[0];
    const values = config.values;
    expect(config.text).toContain('MIN(s.price_kobo)');
    expect(config.text).toContain('MAX(s.price_kobo)');
    expect(config.text).not.toMatch(/\$\d+\s*=/);
    expect(config.query_timeout).toBe(LIVE_FACTS_TIMEOUT_MS);
    expect(values).toEqual([]);

    const live = liveLogs(logLines);
    expect(live).toHaveLength(1);
    const { level, time, msg, hostname, pid, reqId, ...fields } = live[0];
    expect(fields).toEqual({ verdict: 'live-facts', intent: 'price', outcome: 'answered' });
    expect(JSON.stringify(live)).not.toContain('How much is a ticket?');
    expect(JSON.stringify(live)).not.toContain('VI Grand');
    await app.close();
  });

  it('falls back to the existing price reply when there are no rows', async () => {
    mocks.readerQuery.mockResolvedValue({ rows: [] });
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'Ticket prices?');

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_PRICE_TEXT });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(liveLogs(logLines)[0].outcome).toBe('empty');
    await app.close();
  });

  it('never shows a price for a NULL price row', async () => {
    mocks.readerQuery.mockResolvedValue({
      rows: [{ cinema_name: 'VI Grand', low_kobo: null, high_kobo: null }],
    });
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'How much is a ticket?');

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_PRICE_TEXT });
    expect(res.json().reply).not.toContain('₦');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(liveLogs(logLines)[0].outcome).toBe('empty');
    await app.close();
  });

  it('falls back to the existing price reply on a database error', async () => {
    mocks.readerQuery.mockRejectedValue(new Error('database unavailable'));
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'How much is a ticket?');

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_PRICE_TEXT });
    expect(mocks.generate).not.toHaveBeenCalled();
    const { level, time, msg, hostname, pid, reqId, ...fields } = liveLogs(logLines)[0];
    expect(fields).toEqual({ verdict: 'live-facts', intent: 'price', outcome: 'error' });
    expect(JSON.stringify(logLines)).not.toContain('database unavailable');
    await app.close();
  });

  it('leaves other gated intents and gibberish unchanged', async () => {
    const app = await buildAssistantServer([]);

    const hours = await post(app, 'What are your opening hours?');
    expect(hours.json()).toEqual({ reply: factsRefusalText('What are your opening hours?') });

    const gibberish = await post(app, 'asdf qwerty');
    expect(gibberish.json()).toEqual({ reply: 'Model reply' });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.readerQuery).not.toHaveBeenCalled();
    await app.close();
  });

  it('answers a resolved showtime question from the database', async () => {
    mocks.searchMovies.mockResolvedValueOnce({
      movies: [makeMovie('Avatar: The Movie')],
      totalResults: 1,
      stale: false,
    });
    mocks.readerQuery.mockResolvedValue({
      rows: [
        { cinema_name: 'VI Grand', show_date: '2026-11-19', show_time: '13:00' },
        { cinema_name: 'VI Grand', show_date: '2026-11-19', show_time: '16:30' },
        { cinema_name: 'Ikeja Main', show_date: '2026-11-19', show_time: '20:00' },
        { cinema_name: 'VI Grand', show_date: '2026-11-20', show_time: '13:00' },
      ],
    });
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'What time is Avatar showing?');

    expect(res.json()).toEqual({
      reply: [
        'Showtimes for Avatar: The Movie.',
        'Today',
        'Showtimes at Ikeja Main: 20:00.',
        'Showtimes at VI Grand: 13:00, 16:30.',
        'Tomorrow',
        'Showtimes at VI Grand: 13:00.',
      ].join('\n'),
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    const [config] = mocks.readerQuery.mock.calls[0];
    const values = config.values;
    expect(config.text).toContain('ROW_NUMBER() OVER (PARTITION BY c.id');
    expect(config.text).toContain('SELECT DISTINCT cinema_name, show_date, show_time');
    expect(config.text).toContain('ORDER BY show_date ASC, cinema_name ASC, show_time ASC');
    expect(config.text).toContain("'Africa/Lagos'");
    expect(values).toEqual(['550', 3]);
    expect(liveLogs(logLines)[0].outcome).toBe('answered');
    await app.close();
  });

  it('uses the existing showtimes refusal when the match is below the 0.5 floor', async () => {
    mocks.searchMovies.mockResolvedValue({
      movies: [makeMovie('Zzzzz')],
      totalResults: 1,
      stale: false,
    });
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'What time is Avatar showing?');

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_SHOWTIMES_TEXT });
    expect(mocks.readerQuery).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(liveLogs(logLines)[0].outcome).toBe('empty');
    await app.close();
  });

  it('falls back without claiming there are no showtimes when no rows exist', async () => {
    mocks.searchMovies.mockResolvedValueOnce({
      movies: [makeMovie('Avatar')],
      totalResults: 1,
      stale: false,
    });
    mocks.readerQuery.mockResolvedValue({ rows: [] });
    const app = await buildAssistantServer([]);

    const res = await post(app, 'What time is Avatar showing?');

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_SHOWTIMES_TEXT });
    expect(res.json().reply).not.toMatch(/no showtimes|not showing/i);
    expect(mocks.generate).not.toHaveBeenCalled();
    await app.close();
  });

  it('falls back without claiming there are no showtimes on a database error', async () => {
    mocks.searchMovies.mockResolvedValueOnce({
      movies: [makeMovie('Avatar')],
      totalResults: 1,
      stale: false,
    });
    mocks.readerQuery.mockRejectedValue(new Error('database unavailable'));
    const logLines: string[] = [];
    const app = await buildAssistantServer(logLines);

    const res = await post(app, 'What time is Avatar showing?');

    expect(res.json()).toEqual({ reply: FACTS_REFUSAL_SHOWTIMES_TEXT });
    expect(res.json().reply).not.toMatch(/no showtimes|not showing/i);
    expect(mocks.generate).not.toHaveBeenCalled();
    const { level, time, msg, hostname, pid, reqId, ...fields } = liveLogs(logLines)[0];
    expect(fields).toEqual({ verdict: 'live-facts', intent: 'showtimes', outcome: 'error' });
    expect(JSON.stringify(logLines)).not.toContain('database unavailable');
    await app.close();
  });
});
