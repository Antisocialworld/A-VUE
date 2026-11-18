import { ASSISTANT_SUPPORT_CONTACT } from './systemPrompt.js';

export type FactsCheck = { kind: 'ok' } | { kind: 'needs-facts' };

export const FACTS_REFUSAL_TEXT = `I cannot confirm current details here. Open the Showtimes or Tickets screens in A VUE, or contact A VUE support at ${ASSISTANT_SUPPORT_CONTACT}.`;

// Interim deterministic gate for facts that are not injected into the prompt.
// Procedural questions ("how do I book?") stay with the model; live-data lookups do not.
export const FACT_KEYWORDS: readonly RegExp[] = [
  /\bshow\s*times?\b/i,
  /\bscreenings?\b/i,
  /\bsessions?\b/i,
  /\bschedules?\b/i,
  /\bwhat\s+time\b/i,
  /\bstart\s+time\b/i,
  /\bstarts?\s+at\b/i,
  /\bwhat\s*'?s?\s+(?:movies?|films?|showing|playing)\b/i,
  /\b(?:movies?|films?)\s+(?:on|showing|playing)\b/i,
  /\bwhat\s*'?s?\s+on\b/i,
  /\bnow\s+playing\b/i,
  /\bprices?\b/i,
  /\bpricing\b/i,
  /\bcosts?\b/i,
  /\bhow\s+much\b/i,
  /\bfees?\b/i,
  /\brefunds?\b/i,
  /\bcancel(?:lation|s|led|ling|ed|ing)?\b/i,
  /\bpolic(?:y|ies)\b/i,
  /\bterms?\b/i,
  /\bopening\s+(?:hours|times)\b/i,
  /\bopen\s+hours\b/i,
  /\bclosing\s+time\b/i,
  /\bhours\b/i,
  /\blocations?\b/i,
  /\baddress\b/i,
  /\bbranches?\b/i,
  /\bwhere\b/i,
  /\bage\s+(?:ratings?|limit)\b/i,
  /\bcertificate\b/i,
  /\bseat\s+availability\b/i,
  /\bavailable\s+seats?\b/i,
  /\bseats?\s+left\b/i,
  /\bbooking\s+status\b/i,
  /\bmy\s+(?:booking|ticket|order)\b/i,
];

export function checkFacts(text: string): FactsCheck {
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return FACT_KEYWORDS.some((pattern) => pattern.test(normalised)) ? { kind: 'needs-facts' } : { kind: 'ok' };
}
