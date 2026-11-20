/**
 * A VUE RAG chunking, digest and planning helpers.
 * Pure functions only: no file I/O, no network, no database access.
 *
 * ADR 0001: rag_chunks holds A VUE facts-file chunks only. No TMDB data and
 * no user data is read or produced here.
 */

import { createHash } from 'node:crypto';

/** The single facts file ingested by this runner. */
export const RAG_SOURCE_FILE = 'avue-facts.md';

/**
 * Proposed maximum stored chunk size, in characters, including the heading line.
 * Well below the embedding model's 8,192-token input limit.
 */
export const MAX_CHUNK_CHARS = 1200;

export type RagChunk = {
  sourceFile: string;
  chunkIndex: number;
  heading: string;
  content: string;
  contentDigest: string;
};

export type ExistingRagRow = {
  sourceFile: string;
  chunkIndex: number;
  contentDigest: string;
};

export type RagPlan = {
  toEmbed: RagChunk[];
  toSkip: RagChunk[];
  toDelete: ExistingRagRow[];
};

type Section = {
  heading: string;
  headingLine: string;
  body: string;
};

type PendingSection = {
  heading: string;
  headingLine: string;
  bodyLines: string[];
};

// Only '##' and '###' start a chunk. A top-level '# title' is ignored.
const HEADING_RE = /^(##|###)[ \t]+(\S.*)$/;

function splitSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections: Section[] = [];
  let current: PendingSection | null = null;

  const flush = () => {
    if (current) {
      sections.push({
        heading: current.heading,
        headingLine: current.headingLine,
        body: current.bodyLines.join('\n').trim(),
      });
      current = null;
    }
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      current = { heading: match[2].trim(), headingLine: line.trimEnd(), bodyLines: [] };
      continue;
    }
    // Text before the first heading is not part of any section.
    if (current) current.bodyLines.push(line);
  }
  flush();
  return sections;
}

function buildContent(headingLine: string, body: string): string {
  return `${headingLine}\n${body}`;
}

function splitBody(section: Section): string[] {
  if (!section.body) return [];
  if (buildContent(section.headingLine, section.body).length <= MAX_CHUNK_CHARS) {
    return [section.body];
  }

  const paragraphs = section.body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  // An individual paragraph longer than the budget stays whole: paragraph
  // boundaries are the only allowed split points.
  const budget = Math.max(1, MAX_CHUNK_CHARS - section.headingLine.length - 1);
  const bodies: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= budget) {
      current += `\n\n${paragraph}`;
    } else {
      bodies.push(current);
      current = paragraph;
    }
  }
  if (current) bodies.push(current);
  return bodies;
}

/**
 * Hashed bytes: the UTF-8 encoding of RagChunk.content, which is exactly
 * `<heading line, including the ## or ### marker>\n<body>` with no trailing
 * newline added. The same text is what gets stored in rag_chunks.content.
 */
export function contentDigest(content: string): string {
  return createHash('blake2s256').update(content, 'utf8').digest('hex');
}

/**
 * Deterministic: the same markdown and source file always produce the same
 * chunks, digests and chunk_index order (0..n-1 in document order).
 */
export function chunkMarkdown(markdown: string, sourceFile: string = RAG_SOURCE_FILE): RagChunk[] {
  const chunks: RagChunk[] = [];
  for (const section of splitSections(markdown)) {
    for (const body of splitBody(section)) {
      const content = buildContent(section.headingLine, body);
      if (!content.trim()) continue;
      chunks.push({
        sourceFile,
        chunkIndex: chunks.length,
        heading: section.heading,
        content,
        contentDigest: contentDigest(content),
      });
    }
  }
  return chunks;
}

/**
 * Compare by (source_file, chunk_index). Unchanged digests are skipped;
 * rows for a source file we just ingested whose index no longer exists are
 * deleted. Rows belonging to other source files are left alone.
 */
export function planRagIngest(newChunks: RagChunk[], existingRows: ExistingRagRow[]): RagPlan {
  const ingestedSources = new Set(newChunks.map((chunk) => chunk.sourceFile));
  const currentKeys = new Set(
    newChunks.map((chunk) => `${chunk.sourceFile}\u0000${chunk.chunkIndex}`),
  );

  const toEmbed: RagChunk[] = [];
  const toSkip: RagChunk[] = [];
  for (const chunk of newChunks) {
    const unchanged = existingRows.some(
      (row) =>
        row.sourceFile === chunk.sourceFile &&
        row.chunkIndex === chunk.chunkIndex &&
        row.contentDigest === chunk.contentDigest,
    );
    if (unchanged) toSkip.push(chunk);
    else toEmbed.push(chunk);
  }

  const toDelete = existingRows.filter(
    (row) =>
      ingestedSources.has(row.sourceFile) &&
      !currentKeys.has(`${row.sourceFile}\u0000${row.chunkIndex}`),
  );

  return { toEmbed, toSkip, toDelete };
}
