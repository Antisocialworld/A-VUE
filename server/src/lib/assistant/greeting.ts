import { normaliseBrand } from './scopeGuard.js';

export const GREETING_TEXT =
  "Hi, I'm Ask A VUE. I can help with movies, posters and overviews, booking steps and general cinema questions.";

const BASE_GREETINGS = new Set([
  'hi',
  'hello',
  'hey',
  'good morning',
  'good afternoon',
  'good evening',
]);

/**
 * Whole-message greetings only. Punctuation, symbols (including emoji) and optional
 * "there" / "A VUE" are tolerated; anything else means the message is a real question.
 */
export function isGreeting(text: string): boolean {
  const words = normaliseBrand(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  const remainder = [...words];
  const brandIndex = remainder.findIndex((word, i) => word === 'a' && remainder[i + 1] === 'vue');
  if (brandIndex !== -1) remainder.splice(brandIndex, 2);
  const core = remainder.filter((word) => word !== 'there');

  return BASE_GREETINGS.has(core.join(' '));
}
