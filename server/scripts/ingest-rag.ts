/**
 * A VUE RAG facts-file ingest runner.
 *
 *   npm run rag:ingest -- --dry-run   counts only; no embeddings, no writes
 *   npm run rag:ingest                real ingest
 *
 * Prints counts and timings only. Never prints file text, chunk content,
 * vectors or configuration values. Exits non-zero on any failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  RagConfigError,
  runIngest,
  type RagDb,
  type RagEmbedClient,
  type RagIngestDeps,
} from '../src/lib/rag/ingest.js';

const factsPath = path.resolve(process.cwd(), 'data/rag/avue-facts.md');

async function resolveModel(): Promise<string> {
  const { env } = await import('../src/env.js');
  return env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-2';
}

const deps: RagIngestDeps = {
  readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),

  // Read-only: needed for accurate skip/delete counts in a dry run.
  fetchExisting: async (sourceFile) => {
    const { query } = await import('../src/lib/db.js');
    const result = await query<{
      source_file: string;
      chunk_index: number;
      content_digest: string;
    }>(
      'SELECT source_file, chunk_index, content_digest FROM rag_chunks WHERE source_file = $1',
      [sourceFile],
    );
    return result.rows.map((row) => ({
      sourceFile: row.source_file,
      chunkIndex: row.chunk_index,
      contentDigest: row.content_digest,
    }));
  },

  // Same SDK and env config as the assistant model in src/lib/assistant/model.ts.
  createEmbedClient: async () => {
    const { env } = await import('../src/env.js');
    const { GoogleGenAI } = await import('@google/genai');
    if (!env.GEMINI_API_KEY) throw new RagConfigError();
    return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) as unknown as RagEmbedClient;
  },

  // Existing pooled writer config; no second pool or alternate config path.
  createDb: async () => {
    const { writerPool } = await import('../src/lib/db.js');
    return writerPool as unknown as RagDb;
  },

  log: (line) => process.stdout.write(`${line}\n`),
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await runIngest({
    dryRun,
    factsPath,
    deps,
    ...(dryRun ? {} : { model: await resolveModel() }),
  });
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  process.stderr.write(`rag:ingest failed error=${name}\n`);
  process.exitCode = 1;
});
