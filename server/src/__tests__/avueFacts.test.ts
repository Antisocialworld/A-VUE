import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCards } from '../lib/rag/cardLoader.js';

const factsPath = path.resolve(__dirname, '../../data/rag/avue-facts.md');
const cards = parseCards(fs.readFileSync(factsPath, 'utf8'));

describe('A VUE real facts corpus', () => {
  it('contains exactly eight cards', () => {
    expect(cards).toHaveLength(8);
  });

  it('includes the accessibility seats card', () => {
    expect(cards.map((card) => card.id)).toContain('avue-accessibility#seats');
  });

  it('marks every card as updated', () => {
    for (const card of cards) {
      expect(card.updated).toBeDefined();
    }
  });

  it('declares the real whitespace word count for every body', () => {
    for (const card of cards) {
      const actualWords = card.body.trim().split(/\s+/).length;
      expect(card.words).toBe(actualWords);
    }
  });

  it('has no placeholder text in any body', () => {
    const forbidden = ['TBD', 'TODO', 'placeholder', '0800'];
    for (const card of cards) {
      for (const value of forbidden) {
        expect(card.body).not.toContain(value);
      }
    }
  });

  it('uses only real A VUE card ids', () => {
    const forbiddenPrefixes = ['mv-', 'faq-', 'person-', 'cin-'];
    for (const card of cards) {
      for (const prefix of forbiddenPrefixes) {
        expect(card.id.startsWith(prefix)).toBe(false);
      }
    }
  });
});
