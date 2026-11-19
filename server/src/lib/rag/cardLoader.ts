import { readFileSync } from 'node:fs';

export type Card = {
  id: string;
  type: string;
  source: string;
  slug: string;
  words: number;
  updated?: string;
  body: string;
};

export class CardLoaderError extends Error {
  constructor(cardId: string, line: number, detail: string) {
    super(`Invalid card "${cardId}" at line ${line}: ${detail}`);
    this.name = 'CardLoaderError';
  }
}

const MARKER = '## CHUNK ';
const REQUIRED_FIELDS = ['type', 'source', 'slug', 'words'] as const;
const ALLOWED_FIELDS = new Set<string>([...REQUIRED_FIELDS, 'updated']);

type ParsedHeader = {
  type: string;
  source: string;
  slug: string;
  words: number;
  updated?: string;
};

type PendingCard = {
  id: string;
  markerLine: number;
  header: ParsedHeader;
  bodyLines: string[];
};

function parseHeader(headerLine: string, id: string, line: number): ParsedHeader {
  const parts = headerLine.split('|').map((part) => part.trim());
  if (parts.length < REQUIRED_FIELDS.length || parts.length > ALLOWED_FIELDS.size) {
    throw new CardLoaderError(id, line, 'malformed header');
  }

  const fields = new Map<string, string>();
  for (const part of parts) {
    const match = /^([a-z]+):\s*(.+)$/.exec(part);
    if (!match) {
      throw new CardLoaderError(id, line, 'malformed header');
    }
    const [, key, value] = match;
    if (!ALLOWED_FIELDS.has(key)) {
      throw new CardLoaderError(id, line, `unknown header field "${key}"`);
    }
    if (fields.has(key)) {
      throw new CardLoaderError(id, line, `duplicate header field "${key}"`);
    }
    fields.set(key, value.trim());
  }

  for (const key of REQUIRED_FIELDS) {
    if (!fields.has(key)) {
      throw new CardLoaderError(id, line, `missing header field "${key}"`);
    }
  }

  const wordsRaw = fields.get('words')!;
  if (!/^\d+$/.test(wordsRaw)) {
    throw new CardLoaderError(id, line, 'invalid words value');
  }

  const updated = fields.get('updated');
  if (updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    throw new CardLoaderError(id, line, 'invalid updated value');
  }

  return {
    type: fields.get('type')!,
    source: fields.get('source')!,
    slug: fields.get('slug')!,
    words: Number(wordsRaw),
    ...(updated !== undefined ? { updated } : {}),
  };
}

export function parseCards(text: string): Card[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cards: Card[] = [];
  const seenIds = new Set<string>();
  let pending: PendingCard | undefined;

  const finish = () => {
    if (!pending) return;
    const body = pending.bodyLines.join('\n').trim();
    if (body.length === 0) {
      throw new CardLoaderError(pending.id, pending.markerLine, 'empty body');
    }
    if (seenIds.has(pending.id)) {
      throw new CardLoaderError(pending.id, pending.markerLine, 'duplicate id');
    }
    seenIds.add(pending.id);
    cards.push({
      id: pending.id,
      type: pending.header.type,
      source: pending.header.source,
      slug: pending.header.slug,
      words: pending.header.words,
      ...(pending.header.updated !== undefined ? { updated: pending.header.updated } : {}),
      body,
    });
    pending = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith(MARKER)) {
      if (pending) pending.bodyLines.push(line);
      continue;
    }

    finish();
    const id = line.slice(MARKER.length).trim();
    const markerLine = i + 1;
    if (id.length === 0) {
      throw new CardLoaderError('', markerLine, 'missing card id');
    }

    const headerLineNumber = markerLine + 1;
    const headerLine = lines[i + 1];
    if (headerLine === undefined) {
      throw new CardLoaderError(id, headerLineNumber, 'malformed header');
    }
    pending = {
      id,
      markerLine,
      header: parseHeader(headerLine, id, headerLineNumber),
      bodyLines: [],
    };
    i += 1;
  }

  finish();
  return cards;
}

export function loadCardsFromFile(path: string): Card[] {
  return parseCards(readFileSync(path, 'utf8'));
}
