import { ASSISTANT_SUPPORT_CONTACT } from './systemPrompt.js';

export type FactsCheck = { kind: 'ok' } | { kind: 'needs-facts' };

const SUPPORT_TEXT = `contact A VUE support at ${ASSISTANT_SUPPORT_CONTACT}`;

// Plain, intent-specific replies: what cannot be told, then exactly where to look in A VUE.
// Facts that are not shown on any screen are answered with the support contact only.
export const FACTS_REFUSAL_PRICE_TEXT =
  'I cannot confirm ticket prices or fees here. Open the Showtimes or Checkout screen in A VUE.';
export const FACTS_REFUSAL_HOURS_TEXT = `I cannot confirm opening hours here. Please ${SUPPORT_TEXT}.`;
export const FACTS_REFUSAL_SHOWTIMES_TEXT =
  'I cannot confirm showtimes or what is playing here. Open the Movies or Showtimes screen in A VUE.';
export const FACTS_REFUSAL_REFUND_TEXT = `I cannot confirm the full refund policy here. Open the Checkout or Tickets screen in A VUE, or ${SUPPORT_TEXT}.`;
export const FACTS_REFUSAL_POLICY_TEXT = `I cannot confirm age ratings or certificates here. Please ${SUPPORT_TEXT}.`;

/** Generic fallback for any other gated message. */
export const FACTS_REFUSAL_TEXT = `I cannot confirm that here. Please ${SUPPORT_TEXT}.`;

// Fixed templates for the read-only live-data replies. Placeholders are filled from
// database rows only: cinema names, integer kobo converted to naira, and local times.
export const LIVE_PRICE_LINE_TEXT = 'Tickets at {cinema} are {price}.';
export const LIVE_PRICE_RANGE_LINE_TEXT = 'Tickets at {cinema} are from {low} to {high}.';
export const LIVE_SHOWTIMES_TITLE_TEXT = 'Showtimes for {title}.';
export const LIVE_SHOWTIMES_TODAY_TEXT = 'Today';
export const LIVE_SHOWTIMES_TOMORROW_TEXT = 'Tomorrow';
export const LIVE_SHOWTIMES_LINE_TEXT = 'Showtimes at {cinema}: {times}.';

export type FactsIntent = 'price' | 'hours' | 'showtimes' | 'refund' | 'policy' | 'other';

const FACT_INTENT_PATTERNS: readonly (readonly [FactsIntent, RegExp])[] = [
  ['hours', /\bhours?\b|\bopen(?:ing)?\b|\bclosing\b/],
  ['price', /\bprices?\b|\bpricing\b|\bfees?\b|\bhow\s+much\b|\bmuch\b/],
  [
    'showtimes',
    /\bshow\s*times?\b|\bshowings?\b|\bscreenings?\b|\bwhat\s+times?\b|\bstart\s+times?\b|\bnow\s+playing\b|\b(?:showing|playing|on)\b/,
  ],
  ['refund', /\brefunds?\b|\bcancel(?:l?ations?|s|led|ling|ed|ing)?\b/],
  ['policy', /\bage\s+(?:ratings?|limits?)\b|\bcertificates?\b|\bpolic(?:y|ies)\b|\bterms?\b/],
];

/**
 * Closed vocabulary of gate trigger words. A misspelling is only folded onto one of
 * these words when it is a single edit away and long enough not to collide with
 * ordinary film vocabulary. No model call and no free-form correction is involved.
 */
const GATE_VOCABULARY: readonly string[] = [
  'price',
  'prices',
  'ticket',
  'tickets',
  'showtime',
  'showtimes',
  // "showtime(s)" also appears as the two-word "show times" trigger below.
  'time',
  'times',
  'refund',
  'refunds',
  'cancel',
  'cancellation',
  'hours',
  'opening',
  'schedule',
  'schedules',
  'booking',
  'bookings',
  'seat',
  'seats',
];

const GATE_WORDS: ReadonlySet<string> = new Set(GATE_VOCABULARY);
const MIN_CORRECTION_LENGTH = 4;
const MIN_HOW_MUCH_LENGTH = 3;

const HOW_MUCH_CONTEXT =
  "(?:tickets?|seats?|bookings?|cinema|a[\\s._-]*vue|avue|entry|entries|fees?|refunds?)";
const MUCH_CONTEXT_RE = new RegExp(`\\b(?:much|${HOW_MUCH_CONTEXT})\\b`, 'i');

// Real words within one edit of "much" must never be folded onto it. Without this,
// "such a good film at the cinema" was read as a price question.
const MUCH_EXCLUSIONS: ReadonlySet<string> = new Set([
  'such',
  'mush',
  'muck',
  'munch',
  'mucho',
  'ouch',
]);

/** "how" itself, or any one-edit typo of it (including "hw"). */
function isHowLike(token: string): boolean {
  return token === 'how' || isOneEditApart(token, 'how');
}

const MUCH_CONTEXT_AFTER_RE = new RegExp(`^[^.?!]{0,40}\\b${HOW_MUCH_CONTEXT}\\b`, 'i');
const MUCH_CONTEXT_BEFORE_RE = new RegExp(`\\b${HOW_MUCH_CONTEXT}\\b[^.?!]{0,40}$`, 'i');

/** True only for exactly one insert, delete, substitution or adjacent transposition. */
function isOneEditApart(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let mismatches = 0;
    let first = -1;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === b[i]) continue;
      if (mismatches === 0) {
        mismatches = 1;
        first = i;
        continue;
      }
      // Two adjacent mismatches may only be a transposition, and every later
      // character must match. Returning here used to accept distant garbage
      // (e.g. "actors" -> "cancel") just because the first pair transposed.
      if (mismatches !== 1 || first !== i - 1 || a[first] !== b[i] || a[i] !== b[first]) {
        return false;
      }
      mismatches = 2;
    }
    return mismatches === 1 || mismatches === 2;
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }
  return true;
}

function normaliseForGate(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[a-z]+|[^a-z]+/g);
  if (!tokens) return '';

  const corrected = tokens.map((token) => {
    // Already a trigger word: never fold it onto a plural/nearby variant
    // ("booking" -> "bookings" broke the certificate context pattern).
    if (!/^[a-z]+$/.test(token) || token.length < MIN_CORRECTION_LENGTH || GATE_WORDS.has(token)) {
      return token;
    }
    return GATE_VOCABULARY.find((word) => isOneEditApart(token, word)) ?? token;
  });

  // A one-edit typo of "much" counts without a correctly spelled "how" in front of it,
  // but only when live-data context is nearby. This keeps "how much did Avatar make"
  // with the model while "mch for a tiket" is gated. Context words are already folded
  // onto the closed vocabulary above.
  let offset = 0;
  const spans = corrected.map((token) => {
    const span = { token, start: offset, end: offset + token.length };
    offset += token.length;
    return span;
  });
  for (let i = 0; i < spans.length; i += 1) {
    const { token, start, end } = spans[i];
    if (
      !/^[a-z]+$/.test(token) ||
      token === 'much' ||
      MUCH_EXCLUSIONS.has(token) ||
      token.length < MIN_HOW_MUCH_LENGTH
    ) {
      continue;
    }
    if (!isOneEditApart(token, 'much')) continue;
    const current = corrected.join('');
    const window = current.slice(Math.max(0, start - 40), end + 40);
    if (!MUCH_CONTEXT_RE.test(window)) continue;
    corrected[i] = 'much';
  }

  return corrected.join('');
}

// Interim deterministic gate for A VUE live-data questions only. General film questions
// stay with the model. Ambiguous bare words require A VUE/cinema context before gating.
export const FACT_KEYWORDS: readonly RegExp[] = [
  /\bshow\s*times?\b/i,
  /\bscreenings?\b/i,
  /\bshowings?\b/i,
  /\bwhat\s+times?\b/i,
  /\bstart\s+times?\b/i,
  /\bstarts?\s+at\b/i,
  /\bwhat\s*(?:'s|s|is|are)?\s+(?:showing|playing|on)\b/i,
  /\b(?:movies?|films?|showings?|playings?)\s+(?:are\s+)?(?:on|showing|playing)\b/i,
  /\bnow\s+playing\b/i,
  /\bprices?\b/i,
  /\bpricing\b/i,
  /\brefunds?\b/i,
  /\bcancel(?:l?ations?|s|led|ling|ed|ing)?\b/i,
  /\bpolic(?:y|ies)\b/i,
  /\bterms?\s+(?:and\s+conditions|of)\b/i,
  /\b(?:opening|open|closing|cinema)\b[^.?!]{0,30}\bhours?\b/i,
  /\bhours?\b[^.?!]{0,30}\b(?:opening|open|closing|cinema)\b/i,
  /\bclosing\s+times?\b/i,
  /\blocations?\b[^.?!]{0,30}\b(?:cinema|a[\s._-]*vue|avue|branch|address)\b/i,
  /\b(?:cinema|a[\s._-]*vue|avue|branch|address)\b[^.?!]{0,30}\blocations?\b/i,
  /\baddress(?:es)?\b/i,
  /\bwhere\b[^.?!]{0,40}\b(?:cinema|branch|located|find\s+you|you|a[\s._-]*vue|avue)\b/i,
  /\bage\s+(?:ratings?|limits?)\b/i,
  /\b(?:ticket|booking|cinema|a[\s._-]*vue|avue|age)\b[^.?!]{0,30}\bcertificates?\b/i,
  /\bcertificates?\b[^.?!]{0,30}\b(?:ticket|cinema|a[\s._-]*vue|avue|booking|age)\b/i,
  /\bseat\s+availability\b/i,
  /\bavailable\s+seats?\b/i,
  /\bseats?\s+left\b/i,
  /\bbookings?\s+status(?:es)?\b/i,
  /\bmy\s+(?:bookings?|tickets?|orders?)\b/i,
  /\bsessions?\b[^.?!]{0,30}\b(?:cinema|a[\s._-]*vue|avue|movie|ticket)\b/i,
  /\b(?:cinema|a[\s._-]*vue|avue|movie|ticket)\b[^.?!]{0,30}\bsessions?\b/i,
  /\bschedules?\b[^.?!]{0,30}\b(?:cinema|a[\s._-]*vue|avue|movie|ticket)\b/i,
  /\b(?:cinema|a[\s._-]*vue|avue|movie|ticket)\b[^.?!]{0,30}\bschedules?\b/i,
  /\bbranches?\b[^.?!]{0,30}\b(?:cinema|a[\s._-]*vue|avue)\b/i,
  /\b(?:cinema|a[\s._-]*vue|avue)\b[^.?!]{0,30}\bbranches?\b/i,
  /\bfees?\b[^.?!]{0,30}\b(?:ticket|cinema|a[\s._-]*vue|avue|booking)\b/i,
  /\b(?:ticket|cinema|a[\s._-]*vue|avue|booking)\b[^.?!]{0,30}\bfees?\b/i,
];

/**
 * "much" (exact or corrected) only signals an A VUE price question when it follows a
 * how-like token or is one of the first two words, and a live-data context word sits
 * within 40 characters. Plain praise such as "I like this cinema so much" stays with
 * the model, while "mch for a tiket" and "hw much is a ticket" still gate.
 */
function hasQualifiedMuch(normalised: string): boolean {
  const tokens = normalised.match(/[a-z]+|[^a-z]+/g);
  if (!tokens) return false;

  const words: { value: string; start: number }[] = [];
  let offset = 0;
  for (const token of tokens) {
    if (/^[a-z]+$/.test(token)) {
      words.push({ value: token, start: offset });
    }
    offset += token.length;
  }

  for (let i = 0; i < words.length; i += 1) {
    const { value, start } = words[i];
    if (value !== 'much') continue;
    const precededByHow = i > 0 && isHowLike(words[i - 1].value);
    if (!precededByHow && i > 1) continue; // not a how-like lead and not in words 0-1

    const after = normalised.slice(start + value.length).split(/[.?!]/)[0] ?? '';
    const before = normalised.slice(0, start).split(/[.?!]/).pop() ?? '';
    if (MUCH_CONTEXT_AFTER_RE.test(after) || MUCH_CONTEXT_BEFORE_RE.test(before)) {
      return true;
    }
  }
  return false;
}

export function checkFacts(text: string): FactsCheck {
  const normalised = normaliseForGate(text);
  const matched =
    FACT_KEYWORDS.some((pattern) => pattern.test(normalised)) || hasQualifiedMuch(normalised);
  return matched ? { kind: 'needs-facts' } : { kind: 'ok' };
}

/** Picks a fixed reply from the gated message itself; no user text is logged or echoed. */
export function classifyFactsIntent(text: string): FactsIntent {
  const normalised = normaliseForGate(text);
  for (const [intent, pattern] of FACT_INTENT_PATTERNS) {
    if (pattern.test(normalised)) return intent;
  }
  return 'other';
}

export function factsRefusalText(text: string): string {
  switch (classifyFactsIntent(text)) {
    case 'price':
      return FACTS_REFUSAL_PRICE_TEXT;
    case 'hours':
      return FACTS_REFUSAL_HOURS_TEXT;
    case 'showtimes':
      return FACTS_REFUSAL_SHOWTIMES_TEXT;
    case 'refund':
      return FACTS_REFUSAL_REFUND_TEXT;
    case 'policy':
      return FACTS_REFUSAL_POLICY_TEXT;
    default:
      return FACTS_REFUSAL_TEXT;
  }
}
