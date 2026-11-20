import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  chunkMarkdown,
  contentDigest,
  MAX_CHUNK_CHARS,
  planRagIngest,
  RAG_SOURCE_FILE,
} from '../lib/rag/chunker.js';
import {
  documentEmbeddingText,
  EMBED_MODEL,
  embedChunks,
  RagVectorLengthError,
  runIngest,
  writeRagChunks,
  type RagDb,
  type RagEmbedClient,
  type RagIngestDeps,
} from '../lib/rag/ingest.js';

const vector = (length: number): number[] => Array.from({ length }, () => 0.25);

function makeDeps(overrides: Partial<RagIngestDeps> = {}): RagIngestDeps {
  return {
    readFile: () => '## A\na\n',
    fetchExisting: async () => [],
    createEmbedClient: () => {
      throw new Error('no network in dry run');
    },
    createDb: () => {
      throw new Error('no database in dry run');
    },
    log: vi.fn(),
    ...overrides,
  };
}

describe('RAG chunker', () => {
  it('keeps ## and ### heading text on each chunk, in document order', () => {
    const markdown = '# Page title\n\nignored preamble\n\n## Cinema facts\nfirst body\n\n### Refund policy\nsecond body\n';
    const chunks = chunkMarkdown(markdown);

    expect(chunks.map((chunk) => chunk.heading)).toEqual(['Cinema facts', 'Refund policy']);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(chunks[0].content).toBe('## Cinema facts\nfirst body');
    expect(chunks[1].content).toBe('### Refund policy\nsecond body');
    expect(chunks.every((chunk) => chunk.sourceFile === RAG_SOURCE_FILE)).toBe(true);
  });

  it('splits a long section on paragraph boundaries and keeps the heading', () => {
    const paragraphs = Array.from(
      { length: 12 },
      (_, index) => `Paragraph ${index + 1} item text.`.repeat(6),
    );
    const body = paragraphs.join('\n\n');
    const chunks = chunkMarkdown(`## Long\n${body}`);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.startsWith('## Long\n')).toBe(true);
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    const rebuilt = chunks.map((chunk) => chunk.content.slice('## Long\n'.length)).join('\n\n');
    expect(rebuilt).toBe(body);
  });

  it('drops empty heading sections', () => {
    const chunks = chunkMarkdown('## Has body\ntext\n\n## Empty\n\n### Also empty\n');
    expect(chunks.map((chunk) => chunk.heading)).toEqual(['Has body']);
  });

  it('is deterministic', () => {
    const markdown = '## A\na\n\n### B\nb\n';
    expect(chunkMarkdown(markdown)).toEqual(chunkMarkdown(markdown));
  });
});

describe('RAG content digest', () => {
  it('is stable BLAKE2s hex of heading + content', () => {
    const content = '## A\na';
    const digest = contentDigest(content);

    expect(digest).toBe(createHash('blake2s256').update(content, 'utf8').digest('hex'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(contentDigest(content)).toBe(digest);
    expect(contentDigest('## A\nb')).not.toBe(digest);
    expect(chunkMarkdown(content)[0].contentDigest).toBe(digest);
  });
});

describe('RAG ingest plan', () => {
  const chunks = chunkMarkdown('## A\na\n\n## B\nb\n\n## C\nc');

  it('skips unchanged digests, embeds changed ones and deletes removed indices', () => {
    const existing = [
      { sourceFile: RAG_SOURCE_FILE, chunkIndex: 0, contentDigest: chunks[0].contentDigest },
      { sourceFile: RAG_SOURCE_FILE, chunkIndex: 1, contentDigest: 'stale' },
      { sourceFile: RAG_SOURCE_FILE, chunkIndex: 9, contentDigest: 'old' },
      { sourceFile: 'other.md', chunkIndex: 0, contentDigest: 'unrelated' },
    ];

    const plan = planRagIngest(chunks, existing);

    expect(plan.toSkip.map((chunk) => chunk.chunkIndex)).toEqual([0]);
    expect(plan.toEmbed.map((chunk) => chunk.chunkIndex)).toEqual([1, 2]);
    expect(plan.toDelete).toEqual([existing[2]]);
  });

  it('embeds everything and deletes nothing when the table is empty', () => {
    const plan = planRagIngest(chunks, []);
    expect(plan.toEmbed).toEqual(chunks);
    expect(plan.toSkip).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe('RAG embedding payload', () => {
  it('uses the document prefix, one Content per chunk, and 768 dimensions', async () => {
    const chunks = chunkMarkdown('## A\na');
    const embedContent = vi.fn(async () => ({ embeddings: [{ values: vector(768) }] }));
    const client: RagEmbedClient = { models: { embedContent } };

    expect(documentEmbeddingText(chunks[0])).toBe('title: A | text: ## A\na');

    await expect(embedChunks(client, chunks, EMBED_MODEL)).resolves.toHaveLength(1);
    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-2',
      contents: [{ parts: [{ text: 'title: A | text: ## A\na' }] }],
      config: { outputDimensionality: 768 },
    });
  });

  it('rejects a vector that is not exactly 768 finite numbers', async () => {
    const chunks = chunkMarkdown('## A\na');
    const client: RagEmbedClient = {
      models: {
        embedContent: vi.fn(async () => ({ embeddings: [{ values: vector(767) }] })),
      },
    };

    await expect(embedChunks(client, chunks, EMBED_MODEL)).rejects.toBeInstanceOf(
      RagVectorLengthError,
    );
  });
});

describe('RAG dry run and all-or-nothing writes', () => {
  it('prints counts only and makes no embedding or write calls', async () => {
    const log = vi.fn();
    const fetchExisting = vi.fn(async () => []);
    const createEmbedClient = vi.fn(() => {
      throw new Error('no network');
    });
    const createDb = vi.fn(() => {
      throw new Error('no database');
    });

    await runIngest({
      dryRun: true,
      factsPath: 'unused',
      deps: makeDeps({ log, fetchExisting, createEmbedClient, createDb }),
    });

    expect(log).toHaveBeenCalledWith('chunks=1 toEmbed=1 toSkip=0 toDelete=0');
    expect(fetchExisting).toHaveBeenCalledWith(RAG_SOURCE_FILE);
    expect(createEmbedClient).not.toHaveBeenCalled();
    expect(createDb).not.toHaveBeenCalled();
  });

  it('counts skips and deletions in a dry run', async () => {
    const markdown = '## A\na';
    const chunk = chunkMarkdown(markdown)[0];
    const log = vi.fn();

    await runIngest({
      dryRun: true,
      factsPath: 'unused',
      deps: makeDeps({
        readFile: () => markdown,
        fetchExisting: async () => [
          {
            sourceFile: RAG_SOURCE_FILE,
            chunkIndex: 0,
            contentDigest: chunk.contentDigest,
          },
          { sourceFile: RAG_SOURCE_FILE, chunkIndex: 7, contentDigest: 'old' },
        ],
        log,
      }),
    });

    expect(log).toHaveBeenCalledWith('chunks=1 toEmbed=0 toSkip=1 toDelete=1');
  });

  it('aborts before any database connection when embedding fails', async () => {
    const createDb = vi.fn(() => {
      throw new Error('must not connect');
    });
    const client: RagEmbedClient = {
      models: {
        embedContent: vi.fn().mockRejectedValue(new Error('transient')),
      },
    };

    await expect(
      runIngest({
        factsPath: 'unused',
        model: EMBED_MODEL,
        deps: makeDeps({ createEmbedClient: () => client, createDb }),
      }),
    ).rejects.toThrow('transient');
    expect(createDb).not.toHaveBeenCalled();
  });

  it('upserts with parameters and commits the delete in the same transaction', async () => {
    const queries: Array<{ text: string; params?: unknown[] }> = [];
    const connection = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        queries.push({ text, params });
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const db: RagDb = { connect: async () => connection };
    const chunk = chunkMarkdown('## A\na')[0];
    const values = vector(768);

    await writeRagChunks(db, [chunk], [values], [
      { sourceFile: RAG_SOURCE_FILE, chunkIndex: 7, contentDigest: 'old' },
    ]);

    expect(queries.map((entry) => entry.text.split('\n')[0])).toEqual([
      'BEGIN',
      'INSERT INTO rag_chunks',
      'DELETE FROM rag_chunks WHERE source_file = $1 AND chunk_index = $2',
      'COMMIT',
    ]);
    expect(queries[1].params).toEqual([
      RAG_SOURCE_FILE,
      0,
      'A',
      '## A\na',
      chunk.contentDigest,
      `[${values.join(',')}]`,
    ]);
    expect(queries[1].text).toContain('updated_at = NOW()');
    expect(queries[2].params).toEqual([RAG_SOURCE_FILE, 7]);
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
