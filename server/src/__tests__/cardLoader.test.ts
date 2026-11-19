import { describe, expect, it } from 'vitest';
import { CardLoaderError, parseCards } from '../lib/rag/cardLoader.js';

describe('parseCards', () => {
  it('parses a valid card', () => {
    const text = [
      '## CHUNK mv-001#summary',
      'type: movie | source: mv-001 | slug: harbor-lights | words: 2',
      'Short body.',
    ].join('\n');

    expect(parseCards(text)).toEqual([
      {
        id: 'mv-001#summary',
        type: 'movie',
        source: 'mv-001',
        slug: 'harbor-lights',
        words: 2,
        body: 'Short body.',
      },
    ]);
  });

  it('accepts CRLF input', () => {
    const text =
      '## CHUNK x#y\r\ntype: movie | source: x | slug: y | words: 2\r\nCreme body.\r\n';

    expect(parseCards(text)).toEqual([
      {
        id: 'x#y',
        type: 'movie',
        source: 'x',
        slug: 'y',
        words: 2,
        body: 'Creme body.',
      },
    ]);
  });

  it('ignores the preamble before the first card', () => {
    const text = [
      '# Intro',
      'Preamble text.',
      '',
      '## CHUNK x#y',
      'type: movie | source: x | slug: y | words: 2',
      'Body line.',
    ].join('\n');

    expect(parseCards(text)).toHaveLength(1);
    expect(parseCards(text)[0].id).toBe('x#y');
  });

  it('parses the optional updated field', () => {
    const text = [
      '## CHUNK pol-001',
      'type: policy | source: pol-001 | slug: refunds | words: 3 | updated: 2026-01-31',
      'Refunds are allowed.',
      'Ask staff.',
    ].join('\n');

    expect(parseCards(text)).toEqual([
      {
        id: 'pol-001',
        type: 'policy',
        source: 'pol-001',
        slug: 'refunds',
        words: 3,
        updated: '2026-01-31',
        body: 'Refunds are allowed.\nAsk staff.',
      },
    ]);
  });

  it('throws on an unknown header field', () => {
    const text = [
      '## CHUNK x#y',
      'type: movie | source: x | slug: y | words: 2 | extra: nope',
      'Body line.',
    ].join('\n');

    expect(() => parseCards(text)).toThrowError(
      new CardLoaderError('x#y', 2, 'unknown header field "extra"'),
    );
  });

  it('throws on a malformed header with its line number', () => {
    const text = [
      '## CHUNK x#y',
      'type: movie | source x | slug: y | words: 2',
      'Body line.',
    ].join('\n');

    expect(() => parseCards(text)).toThrowError(
      new CardLoaderError('x#y', 2, 'malformed header'),
    );
  });

  it('throws on an empty body', () => {
    const text = [
      '## CHUNK x#y',
      'type: movie | source: x | slug: y | words: 0',
      '',
      '   ',
    ].join('\n');

    expect(() => parseCards(text)).toThrowError(
      new CardLoaderError('x#y', 1, 'empty body'),
    );
  });

  it('throws on a duplicate id', () => {
    const text = [
      '## CHUNK x#y',
      'type: movie | source: x | slug: y | words: 2',
      'First body.',
      '## CHUNK x#y',
      'type: movie | source: x | slug: y | words: 2',
      'Second body.',
    ].join('\n');

    expect(() => parseCards(text)).toThrowError(
      new CardLoaderError('x#y', 4, 'duplicate id'),
    );
  });

  it('preserves unicode body text', () => {
    const text = [
      '## CHUNK x#y',
      'type: movie | source: x | slug: y | words: 3',
      'Café — 日本語 🎬',
      'Crème brûlée.',
    ].join('\n');

    expect(parseCards(text)[0].body).toBe('Café — 日本語 🎬\nCrème brûlée.');
  });
});
