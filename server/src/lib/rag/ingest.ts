/**
 * A VUE RAG ingest orchestration: embeddings and transactional database writes.
 *
 * All I/O is injected so the pure chunk/plan logic stays testable and so a
 * dry run can avoid constructing a network client or a database connection.
 * Logs contain counts and timings only: never chunk text, vectors, file text
 * or configuration values.
 */

import {
  chunkMarkdown,
  planRagIngest,
  RAG_SOURCE_FILE,
  type ExistingRagRow,
  type RagChunk,
  type RagPlan,
} from './chunker.js';

export const EMBED_MODEL = 'gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = 768;
export const EMBED_BATCH_SIZE = 16;

export type RagEmbedClient = {
  models: {
    embedContent(params: {
      model: string;
      contents: Array<{ parts: Array<{ text: string }> }>;
      config?: { outputDimensionality?: number };
    }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
  };
};

export type RagDbClient = {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release(): void;
};

export type RagDb = {
  connect(): Promise<RagDbClient>;
};

export type RagIngestDeps = {
  readFile(filePath: string): string;
  fetchExisting(sourceFile: string): Promise<ExistingRagRow[]>;
  createEmbedClient(): Promise<RagEmbedClient> | RagEmbedClient;
  createDb(): Promise<RagDb> | RagDb;
  log(line: string): void;
};

export type IngestOptions = {
  factsPath: string;
  dryRun?: boolean;
  sourceFile?: string;
  model?: string;
  now?: () => number;
  deps: RagIngestDeps;
};

export class RagConfigError extends Error {
  constructor() {
    super('RAG ingest is not configured.');
    this.name = 'RagConfigError';
  }
}

export class RagEmbeddingError extends Error {
  constructor(detail: string) {
    super(`Embedding failed: ${detail}.`);
    this.name = 'RagEmbeddingError';
  }
}

export class RagVectorLengthError extends Error {
  constructor(chunkIndex: number, length: number) {
    super(
      `Embedding for chunk_index ${chunkIndex} has length ${length}; expected ${EMBEDDING_DIMENSIONS}.`,
    );
    this.name = 'RagVectorLengthError';
  }
}

/**
 * Official Gemini docs for gemini-embedding-2: the `taskType` field is NOT
 * supported. Text-only retrieval uses prompt prefixes instead. Documents are
 * `title: {title} | text: {content}` (use `title: none` when absent).
 * E5 must embed queries as `task: search result | query: {query}`.
 */
export function documentEmbeddingText(chunk: RagChunk): string {
  return `title: ${chunk.heading || 'none'} | text: ${chunk.content}`;
}

/**
 * Each chunk is sent as its own Content object so the SDK returns one vector
 * per chunk (plain strings would be aggregated into a single vector).
 */
export async function embedChunks(
  client: RagEmbedClient,
  chunks: RagChunk[],
  model: string,
  batchSize: number = EMBED_BATCH_SIZE,
): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const response = await client.models.embedContent({
      model,
      contents: batch.map((chunk) => ({ parts: [{ text: documentEmbeddingText(chunk) }] })),
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    const embeddings = response?.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new RagEmbeddingError('returned vector count does not match the batch size');
    }

    for (let j = 0; j < batch.length; j++) {
      const values = embeddings[j]?.values;
      if (
        !Array.isArray(values) ||
        values.length !== EMBEDDING_DIMENSIONS ||
        !values.every((value) => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new RagVectorLengthError(batch[j].chunkIndex, Array.isArray(values) ? values.length : -1);
      }
      vectors.push(values);
    }
  }

  return vectors;
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

/**
 * Upsert and delete in one transaction. Parameterised queries only.
 * updated_at has no trigger, so it is set explicitly to NOW() on every write.
 */
export async function writeRagChunks(
  db: RagDb,
  chunks: RagChunk[],
  vectors: number[][],
  toDelete: ExistingRagRow[],
): Promise<void> {
  if (chunks.length !== vectors.length) {
    throw new RagEmbeddingError('vector count does not match the chunk count');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await client.query(
        `INSERT INTO rag_chunks
           (source_file, chunk_index, heading, content, content_digest, embedding, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::vector, NOW())
         ON CONFLICT (source_file, chunk_index) DO UPDATE SET
           heading = EXCLUDED.heading,
           content = EXCLUDED.content,
           content_digest = EXCLUDED.content_digest,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [
          chunk.sourceFile,
          chunk.chunkIndex,
          chunk.heading,
          chunk.content,
          chunk.contentDigest,
          vectorLiteral(vectors[i]),
        ],
      );
    }
    for (const row of toDelete) {
      await client.query(
        'DELETE FROM rag_chunks WHERE source_file = $1 AND chunk_index = $2',
        [row.sourceFile, row.chunkIndex],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original failure is the one that matters.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Chunk -> plan -> (dry run: counts only) -> embed all -> write all.
 * Embedding failures happen before a database connection is requested, so a
 * failed run makes no writes and is safe to re-run.
 */
export async function runIngest(options: IngestOptions): Promise<RagPlan> {
  const { dryRun = false, deps } = options;
  const startedAt = options.now?.() ?? Date.now();
  const sourceFile = options.sourceFile ?? RAG_SOURCE_FILE;

  const chunks = chunkMarkdown(deps.readFile(options.factsPath), sourceFile);
  const existingRows = await deps.fetchExisting(sourceFile);
  const plan = planRagIngest(chunks, existingRows);

  if (dryRun) {
    deps.log(
      `chunks=${chunks.length} toEmbed=${plan.toEmbed.length} ` +
        `toSkip=${plan.toSkip.length} toDelete=${plan.toDelete.length}`,
    );
    return plan;
  }

  if (plan.toEmbed.length > 0) {
    const client = await deps.createEmbedClient();
    const vectors = await embedChunks(client, plan.toEmbed, options.model ?? EMBED_MODEL);
    const db = await deps.createDb();
    await writeRagChunks(db, plan.toEmbed, vectors, plan.toDelete);
  } else if (plan.toDelete.length > 0) {
    const db = await deps.createDb();
    await writeRagChunks(db, [], [], plan.toDelete);
  }

  const elapsedMs = (options.now?.() ?? Date.now()) - startedAt;
  deps.log(
    `chunks=${chunks.length} toEmbed=${plan.toEmbed.length} ` +
      `toSkip=${plan.toSkip.length} toDelete=${plan.toDelete.length} elapsedMs=${elapsedMs}`,
  );
  return plan;
}
