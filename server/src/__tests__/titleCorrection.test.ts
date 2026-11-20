import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerate, mockGetCachedJson, mockSetCachedJson, mockSingleFlight, mockSearchRateLimit } =
  vi.hoisted(() => ({
    mockGenerate: vi.fn(),
    mockGetCachedJson: vi.fn(),
    mockSetCachedJson: vi.fn(),
    mockSingleFlight: vi.fn(),
    mockSearchRateLimit: vi.fn(),
  }));

vi.mock('../env.js', () => ({
  env: {
    GEMINI_API_KEY: 'test-key',
    GEMINI_CHAT_MODEL: 'test-chat-model',
    GEMINI_ATTEMPT_TIMEOUT_MS: 8000,
  },
}));

vi.mock('../lib/assistant/model.js', () => ({
  generate: (...args: unknown[]) => mockGenerate(...args),
}));

vi.mock('../lib/tmdb.js', () => ({
  getCachedJson: (...args: unknown[]) => mockGetCachedJson(...args),
  setCachedJson: (...args: unknown[]) => mockSetCachedJson(...args),
  singleFlight: (_key: string, fn: () => Promise<unknown>) => mockSingleFlight(fn),
}));

vi.mock('../lib/rateLimit.js', () => ({
  searchRateLimit: (...args: unknown[]) => mockSearchRateLimit(...args),
}));

import {
  correctMovieTitle,
  isAllowedCorrectionInput,
  TITLE_CORRECTION_INSTRUCTION,
} from '../lib/titleCorrection.js';

describe('title correction', () => {
  let stdout: { mockRestore: () => void; mock: { calls: unknown[][] } };
  let clock = Date.parse('2026-01-01T00:00:00Z');

  beforeEach(() => {
    clock += 600000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(clock));
    mockGenerate.mockReset();
    mockGetCachedJson.mockReset().mockResolvedValue(null);
    mockSetCachedJson.mockReset().mockResolvedValue(undefined);
    mockSingleFlight.mockReset().mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockSearchRateLimit.mockReset().mockResolvedValue(undefined);
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const logs = (): unknown[] =>
    stdout.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('"verdict":"title-correction"'))
      .map((line) => JSON.parse(line));

  it('returns a corrected title and sends only the typed text to the model', async () => {
    mockGenerate.mockResolvedValue('The Sound of Music');

    await expect(correctMovieTitle('sund of music', 'search')).resolves.toBe('The Sound of Music');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({
      system: TITLE_CORRECTION_INSTRUCTION,
      history: [],
      message: 'sund of music',
      attempt: 'primary',
    });
  });

  it.each(['NONE', 'none', ''])('returns null for %s', async (output) => {
    mockGenerate.mockResolvedValue(output);
    await expect(correctMovieTitle('sund of music')).resolves.toBeNull();
  });

  it.each([
    ['"The Sound of Music"', 'The Sound of Music'],
    ["'The Sound of Music'", 'The Sound of Music'],
  ])('strips surrounding quotes from %s', async (output, expected) => {
    mockGenerate.mockResolvedValue(output);
    await expect(correctMovieTitle('sund of music')).resolves.toBe(expected);
  });

  it.each(['first line\nsecond line', `a${'x'.repeat(81)}`, 'user@example.com', 'Bad@Title'])(
    'rejects unsafe output',
    async (output) => {
      mockGenerate.mockResolvedValue(output);
      await expect(correctMovieTitle('sund of music')).resolves.toBeNull();
    },
  );

  it.each([
    'ab',
    'a'.repeat(61),
    'mail@example.com',
    '123456789',
    '0803 123 4567',
    'title<script>',
  ])('never calls the model for guarded input %s', async (input) => {
    await expect(correctMovieTitle(input)).resolves.toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(logs()).toEqual([{ verdict: 'title-correction', outcome: 'skipped', stage: 'search' }]);
  });

  it('exports the guard used for raw text, including the total-digit rule', () => {
    expect(isAllowedCorrectionInput('sund of music')).toBe(true);
    expect(isAllowedCorrectionInput('john@mail.com')).toBe(false);
    expect(isAllowedCorrectionInput('0803 123 4567')).toBe(false);
  });

  it('does not cache a model error: a second call calls the model again', async () => {
    mockGenerate.mockRejectedValue(new Error('RAW_MODEL_ERROR'));

    await expect(correctMovieTitle('sund of music', 'assistant')).resolves.toBeNull();
    await expect(correctMovieTitle('sund of music', 'assistant')).resolves.toBeNull();

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockSetCachedJson).not.toHaveBeenCalled();
    expect(logs()).toEqual([
      { verdict: 'title-correction', outcome: 'error', stage: 'assistant' },
      { verdict: 'title-correction', outcome: 'error', stage: 'assistant' },
    ]);
  });

  it('does not spend rate-limit allowance on a cache hit', async () => {
    mockGenerate.mockResolvedValue('NONE');

    await correctMovieTitle('sund of music');
    await correctMovieTitle('sund of music');

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockSearchRateLimit).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached miss so a repeat typed title makes one model call', async () => {
    mockGenerate.mockResolvedValue('NONE');

    await expect(correctMovieTitle('sund of music')).resolves.toBeNull();
    await expect(correctMovieTitle('SUND   OF MUSIC')).resolves.toBeNull();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('logs only closed-set fields and never the typed text or output', async () => {
    mockGenerate.mockResolvedValue('The Sound of Music');

    await correctMovieTitle('sund of music', 'assistant');

    const lines = logs();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0] as object).sort()).toEqual(['outcome', 'stage', 'verdict']);
    expect((lines[0] as { outcome: string }).outcome).toBe('corrected');
    const output = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(output).not.toContain('sund of music');
    expect(output).not.toContain('The Sound of Music');
  });
});
