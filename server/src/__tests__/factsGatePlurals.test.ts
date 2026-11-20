import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_SUPPORT_CONTACT,
} from '../lib/assistant/systemPrompt.js';
import {
  checkFacts,
  factsRefusalText,
  FACTS_REFUSAL_HOURS_TEXT,
  FACTS_REFUSAL_POLICY_TEXT,
  FACTS_REFUSAL_PRICE_TEXT,
  FACTS_REFUSAL_REFUND_TEXT,
  FACTS_REFUSAL_SHOWTIMES_TEXT,
  FACTS_REFUSAL_TEXT,
} from '../lib/assistant/factsGate.js';

describe('facts gate plural forms', () => {
  it.each([
    'Show me my tickets',
    'Show me my bookings',
    'Show me my orders',
    'What times are available?',
    'What are the start times?',
    'Are there cancellations?',
    'What are the closing times?',
    'Is it open for an hour?',
    'What are the addresses?',
    'Age limits?',
    'Booking statuses?',
    'What are the showings?',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });
});

describe('facts gate keeps A VUE live data gated', () => {
  it.each([
    'what time is the movie',
    'how much is a ticket',
    'opening hours',
    'refund policy',
    'where is the cinema',
    'my tickets',
    'what is showing today',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });
});

describe('facts gate keeps A VUE-tied certificate questions gated', () => {
  it.each([
    'what is the age rating',
    'age limit?',
    'certificate for my ticket',
    'booking certificate question',
    'cinema certificates?',
    'A VUE certificate',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });
});

describe('facts gate lets general film questions reach the model', () => {
  it.each([
    'who directed Inception',
    'where was Dune filmed',
    'how many hours long is Oppenheimer',
    'what did Avatar cost to make',
    'who is in the cast of Titanic',
    'what genre is Alien',
    'recommend a thriller',
    'what does a cinematographer do',
    'what is a film score',
    'terms used in film editing',
    'how do actors audition',
    'how do actors prepare for a role',
    'how do directors work with actors',
    'how do editors cut a film',
    'how do cinematographers light a scene',
    // Bare certificate questions are general film ratings, not A VUE live data.
    'Certificates?',
    'certificate',
    'what certificate is Oppenheimer',
  ])('does not gate "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'ok' });
  });
});

describe('facts gate closes one-edit typos onto the fixed vocabulary', () => {
  it.each([
    'how mch is a ticket',
    'how much is a tiket',
    'whats the pirce',
    'refnd policy',
    'opning hours',
    'show tmes',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });

  it.each([
    'who directed inception',
    'where was dune filmed',
    'how much did avatar make',
    'tell me about horror films',
    'what does a gaffer do',
    // Previously over-blocked by the bare "how much" pattern.
    "how much was Titanic's budget",
  ])('passes "%s" to the model', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'ok' });
  });

  it('does not correct beyond one edit or outside the closed vocabulary', () => {
    expect(checkFacts('what is the pricccc')).toEqual({ kind: 'ok' });
    expect(checkFacts('what is the praze')).toEqual({ kind: 'ok' });
  });

  it('keeps gated how-much questions with cinema, seat and refund context', () => {
    expect(checkFacts('how much is entry at the cinema')).toEqual({ kind: 'needs-facts' });
    expect(checkFacts('how much are the seats')).toEqual({ kind: 'needs-facts' });
    expect(checkFacts('how much is my refund')).toEqual({ kind: 'needs-facts' });
  });
});

describe('facts gate does not need a correctly spelled "how" for "much" typos', () => {
  it.each([
    'hw much is a ticket',
    'how mch is a ticket',
    'how much ticket',
    'mch for a tiket',
    'price of a ticket?',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });

  it.each([
    'how much did Avatar make',
    "how much was Titanic's budget",
    'how much does a cinematographer earn',
  ])('passes "%s" to the model', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'ok' });
  });
});

describe('facts gate "much" needs a how-like lead or an early position', () => {
  it.each([
    'how much is a ticket',
    'hw much is a ticket',
    'how mch is a ticket',
    'mch for a tiket',
    'much is a ticket?',
    'how much ticket',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });

  it.each([
    'I like this cinema so much',
    'such a good film at the cinema',
    'Ouch, that film was great',
    'how much did Avatar make',
    "how much was Titanic's budget",
    'how much does a cinematographer earn',
  ])('passes "%s" to the model', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'ok' });
  });
});

describe('facts gate fixed replies name only real destinations', () => {
  it('uses a different short reply per intent', () => {
    expect(factsRefusalText('ticket price')).toBe(FACTS_REFUSAL_PRICE_TEXT);
    expect(factsRefusalText('what are your opening hours')).toBe(FACTS_REFUSAL_HOURS_TEXT);
    expect(factsRefusalText('showtimes today')).toBe(FACTS_REFUSAL_SHOWTIMES_TEXT);
    expect(factsRefusalText('refund policy')).toBe(FACTS_REFUSAL_REFUND_TEXT);
    expect(factsRefusalText('what is the age rating')).toBe(FACTS_REFUSAL_POLICY_TEXT);
    expect(factsRefusalText('Show me my tickets')).toBe(FACTS_REFUSAL_TEXT);
  });

  it('gives the support contact only where no screen shows the fact', () => {
    expect(FACTS_REFUSAL_HOURS_TEXT).toContain(ASSISTANT_SUPPORT_CONTACT);
    expect(FACTS_REFUSAL_POLICY_TEXT).toContain(ASSISTANT_SUPPORT_CONTACT);
    expect(FACTS_REFUSAL_TEXT).toContain(ASSISTANT_SUPPORT_CONTACT);
  });

  it('keeps every reply to at most two sentences', () => {
    for (const reply of [
      FACTS_REFUSAL_PRICE_TEXT,
      FACTS_REFUSAL_HOURS_TEXT,
      FACTS_REFUSAL_SHOWTIMES_TEXT,
      FACTS_REFUSAL_REFUND_TEXT,
      FACTS_REFUSAL_POLICY_TEXT,
      FACTS_REFUSAL_TEXT,
    ]) {
      expect(reply.split(/[.!?]+/).filter((part) => part.trim().length > 0).length).toBeLessThanOrEqual(2);
    }
  });
});
