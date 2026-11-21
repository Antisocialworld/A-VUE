import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readerQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../lib/db.js', () => ({
  readerPool: { query: mocks.readerQuery },
}));

vi.mock('../env.js', () => ({
  env: {
    NODE_ENV: 'test',
    GEMINI_API_KEY: 'test-key',
    GEMINI_CHAT_MODEL: 'gemini-test-model',
    GEMINI_EMBEDDING_MODEL: 'gemini-embedding-2',
    EMBEDDING_DIMENSIONS: 768,
    RATE_LIMIT_SEARCH_USER: 30,
    RATE_LIMIT_SEARCH_IP: 30,
  },
  isAdmin: () => false,
  getTmdbToken: () => undefined,
  getSearchCacheTtlSeconds: () => 600,
}));

import { RAG_SOURCE_FILE } from '../lib/rag/chunker.js';
import {
  MAX_DISTANCE,
  queryVectorCacheKey,
  queryRagRows,
  RagRateLimitedError,
  RagVectorError,
  retrieveFactChunks,
  retrieveRawFactChunks,
  RAG_ANSWER_RULE_TEXT,
  RAG_FACTS_DATA_END,
  RAG_FACTS_DATA_START,
  TOP_K,
  withRagFactContext,
  type RagRetrieveDeps,
} from '../lib/rag/retrieve.js';

const vector = Array.from({ length: 768 }, (_, index) => index / 10000);

const row = (heading: string, distance: number) => ({
  heading,
  content: `content for ${heading}`,
  distance,
});

function makeDeps(overrides: Partial<RagRetrieveDeps> = {}): RagRetrieveDeps {
  return {
    getCachedJson: vi.fn().mockResolvedValue(null),
    setCachedJson: vi.fn().mockResolvedValue(undefined),
    withinRateLimit: vi.fn().mockResolvedValue(true),
    embedQuery: vi.fn().mockResolvedValue(vector),
    queryRows: vi.fn().mockResolvedValue([row('CHUNK one#a', 0.1)]),
    ...overrides,
  };
}

const logs: string[] = [];
let originalWrite: typeof process.stdout.write;

beforeEach(() => {
  logs.length = 0;
  originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    logs.push(String(chunk));
    return originalWrite.call(process.stdout, chunk, ...args);
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe('Task 1: E5 query embedding and vector search', () => {
  it('uses the exact E5 query prefix and normalised query', async () => {
    const deps = makeDeps();
    await retrieveRawFactChunks('Where are A VUE cinemas?', { deps });

    expect(deps.embedQuery).toHaveBeenCalledWith(
      'task: search result | query: where are a vue cinemas?',
      undefined,
    );
    expect(deps.queryRows).toHaveBeenCalledWith(`[${vector.join(',')}]`, TOP_K);
  });

  it('passes the non-empty ingest source file as the SQL source_file parameter', async () => {
    mocks.readerQuery.mockClear();

    await queryRagRows(`[${vector.join(',')}]`, TOP_K);

    const [sql, params] = mocks.readerQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE source_file = $2');
    expect(params).toHaveLength(3);
    expect(params[1]).toBe(RAG_SOURCE_FILE);
    expect(typeof params[1]).toBe('string');
    expect((params[1] as string).length).toBeGreaterThan(0);
  });

  it('rejects vectors that are not exactly 768 finite numbers', async () => {
    const deps = makeDeps({ embedQuery: vi.fn().mockResolvedValue(vector.slice(0, 767)) });
    await expect(retrieveRawFactChunks('where are a vue cinemas', { deps })).rejects.toBeInstanceOf(
      RagVectorError,
    );
    expect(deps.setCachedJson).not.toHaveBeenCalled();
  });

  it('keeps ordered results and applies the provisional K and threshold', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => row(`heading-${index}`, 0.05 * index));
    const deps = makeDeps({ queryRows: vi.fn().mockResolvedValue(rows) });

    const result = await retrieveFactChunks('seats held for ten minutes', undefined, deps);

    expect(result.map((chunk) => chunk.heading)).toEqual(rows.slice(0, TOP_K).map((r) => r.heading));
    expect(result.every((chunk) => chunk.distance <= MAX_DISTANCE)).toBe(true);
  });

  it('drops every chunk when none clears the threshold', async () => {
    const deps = makeDeps({
      queryRows: vi.fn().mockResolvedValue([row('CHUNK one#a', MAX_DISTANCE + 0.01)]),
    });

    await expect(retrieveFactChunks('unknown question', undefined, deps)).resolves.toEqual([]);
    expect(logs.join(' ')).toContain('"outcome":"none"');
  });
});

describe('Task 1: fail-open paths', () => {
  it('returns no chunks and logs error when embedding fails', async () => {
    const deps = makeDeps({ embedQuery: vi.fn().mockRejectedValue(new Error('embed failed')) });

    await expect(retrieveFactChunks('where are a vue cinemas', undefined, deps)).resolves.toEqual([]);
    expect(deps.setCachedJson).not.toHaveBeenCalled();
    expect(logs.join(' ')).toContain('"outcome":"error"');
  });

  it('returns no chunks and caches nothing when the database fails', async () => {
    const deps = makeDeps({ queryRows: vi.fn().mockRejectedValue(new Error('db failed')) });

    await expect(retrieveFactChunks('where are a vue cinemas', undefined, deps)).resolves.toEqual([]);
    expect(deps.setCachedJson).not.toHaveBeenCalled();
  });

  it('returns no chunks on an empty table', async () => {
    const deps = makeDeps({ queryRows: vi.fn().mockResolvedValue([]) });
    await expect(retrieveFactChunks('where are a vue cinemas', undefined, deps)).resolves.toEqual([]);
    expect(logs.join(' ')).toContain('"outcome":"none"');
  });

  it('returns no chunks when its own deadline or the shared limiter skips retrieval', async () => {
    const timedOut = makeDeps({
      embedQuery: vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    });
    await expect(retrieveFactChunks('where are a vue cinemas', undefined, timedOut)).resolves.toEqual([]);

    const limited = makeDeps({ withinRateLimit: vi.fn().mockResolvedValue(false) });
    await expect(retrieveFactChunks('where are a vue cinemas', undefined, limited)).resolves.toEqual([]);
    expect(limited.embedQuery).not.toHaveBeenCalled();
    expect(logs.join(' ')).toContain('"outcome":"skipped"');
  });

  it('does not throw a rate-limit error into the route', async () => {
    const deps = makeDeps({ withinRateLimit: vi.fn().mockRejectedValue(new RagRateLimitedError()) });
    await expect(retrieveFactChunks('where are a vue cinemas', undefined, deps)).resolves.toEqual([]);
  });
});

describe('Task 1: query-vector cache and logging', () => {
  it('uses a cache hit before the limiter and embed client', async () => {
    const deps = makeDeps({
      getCachedJson: vi.fn().mockResolvedValue(vector),
      withinRateLimit: vi.fn().mockResolvedValue(true),
    });

    const result = await retrieveFactChunks('where are a vue cinemas', undefined, deps);

    expect(result).toHaveLength(1);
    expect(deps.withinRateLimit).not.toHaveBeenCalled();
    expect(deps.embedQuery).not.toHaveBeenCalled();
    expect(deps.queryRows).toHaveBeenCalledTimes(1);
    expect(deps.setCachedJson).not.toHaveBeenCalled();
  });

  it('never puts raw query text in the cache key or closed-set logs', async () => {
    const rawQuery = 'where are A VUE cinemas in Lagos';
    const deps = makeDeps();
    await retrieveFactChunks(rawQuery, undefined, deps);

    const key = (deps.getCachedJson as any).mock.calls[0][0] as string;
    expect(key).toMatch(/^rag-query:[0-9a-f]{64}$/);
    expect(key).not.toContain(rawQuery);
    expect(queryVectorCacheKey(rawQuery)).toBe(queryVectorCacheKey(rawQuery.toLowerCase()));
    for (const line of logs) {
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(['outcome', 'verdict']);
      expect(line).not.toContain(rawQuery);
    }
  });
});

describe('Task 1: context shaping', () => {
  it('delimits chunk data outside the answer rule', () => {
    const system = 'system prompt';
    const context = withRagFactContext(system, [
      { heading: 'CHUNK one#a', content: 'A VUE fact.', distance: 0.1 },
    ]);

    expect(context.startsWith(system)).toBe(true);
    expect(context).toContain(RAG_ANSWER_RULE_TEXT);
    expect(context.indexOf(RAG_FACTS_DATA_START)).toBeLessThan(context.indexOf(RAG_FACTS_DATA_END));
    expect(context).toContain('heading: CHUNK one#a\ncontent: A VUE fact.');
    expect(withRagFactContext(system, [])).toBe(system);
  });
});
