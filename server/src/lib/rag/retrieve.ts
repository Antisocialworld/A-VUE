/**
 * A VUE facts retrieval for the assistant.
 *
 * ADR 0001: this module reads rag_chunks only. It never reads or writes TMDB data,
 * user data, message text, vectors or chunk content to logs. Logs are closed-set.
 */

import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { env } from '../../env.js';
import { readerPool } from '../db.js';
import { getCachedJson, setCachedJson } from '../tmdb.js';
import { searchRateLimit } from '../rateLimit.js';
import { EMBEDDING_DIMENSIONS, EMBED_MODEL } from './ingest.js';
import { RAG_SOURCE_FILE } from './chunker.js';

/** K = 4 kept: one eval query ranked its expected chunk second; the other 71 ranked first. */
export const TOP_K = 4;
/** 102-case eval 21 Nov 2026: 72 positives all top 4, 71 first (one second), max positive 0.2943; 30 negatives, unrelated >= 0.3516, cinema-adjacent from 0.2459. Chosen 0.34 to favour recall; cinema-adjacent includes are harmless because the answer rule says "not sure" when facts do not cover the question. */
export const MAX_DISTANCE = 0.34;
/** Retrieval has its own budget, well below the 10 s model clamp. */
export const RAG_RETRIEVAL_DEADLINE_MS = 3000;
export const QUERY_VECTOR_TTL_SECONDS = 300;

export type RagChunkHit = {
  heading: string;
  content: string;
  distance: number;
};

export type RagRetrieveOutcome = 'hit' | 'none' | 'error' | 'skipped';

type RagRow = {
  heading: string;
  content: string;
  distance: number | string;
};

/**
 * Dependencies are injectable so tests can mock the embed client and database without
 * network access. The production defaults are the existing Gemini client, pg reader pool,
 * Redis cache helpers and the shared search limiter bucket.
 */
export type RagRetrieveDeps = {
  getCachedJson<T>(key: string): Promise<T | null>;
  setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  withinRateLimit(): Promise<boolean>;
  embedQuery(prefixedQuery: string, signal?: AbortSignal): Promise<number[]>;
  queryRows(vectorLiteral: string, limit: number): Promise<RagRow[]>;
};

export class RagRateLimitedError extends Error {
  constructor() {
    super('RAG_RETRIEVAL_RATE_LIMITED');
    this.name = 'RagRateLimitedError';
  }
}

export class RagDeadlineError extends Error {
  constructor() {
    super('RAG_RETRIEVAL_DEADLINE_EXCEEDED');
    this.name = 'RagDeadlineError';
  }
}

export class RagVectorError extends Error {
  constructor() {
    super('RAG_QUERY_VECTOR_INVALID');
    this.name = 'RagVectorError';
  }
}

/** Lowercase, accent-insensitive whitespace normalisation used only for cache identity. */
export function normaliseRagQuery(query: string): string {
  return query
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** BLAKE2s of the normalised query only; the raw query is never a key or log field. */
export function queryVectorCacheKey(query: string): string {
  return `rag-query:${crypto.createHash('blake2s256').update(normaliseRagQuery(query)).digest('hex')}`;
}

export function isValidRagVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

/** The E5 query prefix is mandatory; gemini-embedding-2 has no taskType field. */
export function ragQueryEmbeddingText(normalisedQuery: string): string {
  return `task: search result | query: ${normalisedQuery}`;
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new RagDeadlineError());
      return;
    }
    signal.addEventListener('abort', () => reject(new RagDeadlineError()), { once: true });
  });
}

async function withDeadline<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return Promise.race([work, abortPromise(signal)]);
}

/** Uses the shared search bucket with a closed-set synthetic identity; no user data. */
async function ragRateLimit(): Promise<boolean> {
  let limited = false;
  const reply = {
    header: () => reply,
    status: (code: number) => {
      if (code === 429) limited = true;
      return reply;
    },
    send: () => reply,
  } as any;
  const request = { ip: 'assistant-rag', id: 'assistant-rag' } as any;
  try {
    await searchRateLimit(request, reply);
    return !limited;
  } catch {
    return true;
  }
}

async function embedQueryWithSdk(prefixedQuery: string, signal?: AbortSignal): Promise<number[]> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY_MISSING');
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = (await withDeadline(
    ai.models.embedContent({
      model: env.GEMINI_EMBEDDING_MODEL ?? EMBED_MODEL,
      contents: [{ parts: [{ text: prefixedQuery }] }],
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    } as any),
    signal,
  )) as { embeddings?: Array<{ values?: number[] }> };
  const values = response?.embeddings?.[0]?.values;
  if (!isValidRagVector(values)) throw new RagVectorError();
  return values;
}

export async function queryRagRows(vectorLiteralValue: string, limit: number): Promise<RagRow[]> {
  const result = await readerPool.query<RagRow>(
    `SELECT heading, content, (embedding <=> $1::vector) AS distance
       FROM rag_chunks
      WHERE source_file = $2
      ORDER BY distance ASC
      LIMIT $3`,
    [vectorLiteralValue, RAG_SOURCE_FILE, limit],
  );
  return result.rows ?? [];
}

const defaultDeps: RagRetrieveDeps = {
  getCachedJson,
  setCachedJson,
  withinRateLimit: ragRateLimit,
  embedQuery: embedQueryWithSdk,
  queryRows: queryRagRows,
};

/**
 * Query embedding + parameterised vector search. No threshold or K is applied here;
 * the eval script uses this so raw distances remain visible.
 */
export async function retrieveRawFactChunks(
  query: string,
  options: {
    limit?: number;
    signal?: AbortSignal;
    deps?: RagRetrieveDeps;
  } = {},
): Promise<RagChunkHit[]> {
  const deps = options.deps ?? defaultDeps;
  const normalised = normaliseRagQuery(query);
  if (!normalised) return [];
  if (options.signal?.aborted) throw new RagDeadlineError();

  const key = queryVectorCacheKey(normalised);
  const cached = await withDeadline(deps.getCachedJson<unknown>(key), options.signal);
  let vector: number[];
  let cacheHit = false;

  if (isValidRagVector(cached)) {
    // Cache hit precedes the limiter and both network clients; it never extends the TTL.
    vector = cached;
    cacheHit = true;
  } else {
    if (!(await withDeadline(deps.withinRateLimit(), options.signal))) {
      throw new RagRateLimitedError();
    }
    vector = await withDeadline(
      deps.embedQuery(ragQueryEmbeddingText(normalised), options.signal),
      options.signal,
    );
    if (!isValidRagVector(vector)) throw new RagVectorError();
  }

  const rows = await withDeadline(
    deps.queryRows(vectorLiteral(vector), options.limit ?? TOP_K),
    options.signal,
  );
  // Cache only after a fresh embed and a completed query. A hit never re-writes the
  // vector or refreshes the TTL; limiter, embed and database errors are never cached.
  if (!cacheHit) {
    await deps.setCachedJson(key, vector, QUERY_VECTOR_TTL_SECONDS);
  }
  return rows.map((row) => ({
    heading: row.heading,
    content: row.content,
    distance: Number(row.distance),
  }));
}

export function logRagRetrieval(outcome: RagRetrieveOutcome): void {
  process.stdout.write(`${JSON.stringify({ verdict: 'rag-retrieval', outcome })}\n`);
}

/**
 * Fail-open public entry point. It returns [] on every failure path; route behaviour is
 * unchanged when no chunk clears the provisional threshold.
 */
export async function retrieveFactChunks(
  query: string,
  signal?: AbortSignal,
  deps?: RagRetrieveDeps,
): Promise<RagChunkHit[]> {
  if (signal?.aborted || !env.GEMINI_API_KEY) {
    logRagRetrieval('skipped');
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RAG_RETRIEVAL_DEADLINE_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const rows = await retrieveRawFactChunks(query, {
      limit: TOP_K,
      signal: controller.signal,
      deps,
    });
    const hits = rows
      .filter((row) => Number.isFinite(row.distance) && row.distance <= MAX_DISTANCE)
      .slice(0, TOP_K);
    logRagRetrieval(hits.length > 0 ? 'hit' : 'none');
    return hits;
  } catch (error) {
    logRagRetrieval(
      error instanceof RagRateLimitedError || error instanceof RagDeadlineError ? 'skipped' : 'error',
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Chunks are data only. The instruction stays outside the delimited block. */
export const RAG_ANSWER_RULE_TEXT =
  'For A VUE fact questions, answer only from these A VUE facts; if they do not contain the answer say you are not sure.';
export const RAG_FACTS_DATA_START = '<A_VUE_FACTS_DATA>';
export const RAG_FACTS_DATA_END = '</A_VUE_FACTS_DATA>';

export function withRagFactContext(system: string, chunks: RagChunkHit[]): string {
  if (chunks.length === 0) return system;
  return [
    system,
    RAG_ANSWER_RULE_TEXT,
    `${RAG_FACTS_DATA_START}\n${chunks
      .map((chunk) => `heading: ${chunk.heading}\ncontent: ${chunk.content}`)
      .join('\n\n')}\n${RAG_FACTS_DATA_END}`,
  ].join('\n');
}
