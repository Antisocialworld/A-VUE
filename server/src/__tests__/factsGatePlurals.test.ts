import { describe, expect, it } from 'vitest';
import { checkFacts } from '../lib/assistant/factsGate.js';

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
    'Certificates?',
    'Booking statuses?',
    'What are the showings?',
  ])('gates "%s"', (message) => {
    expect(checkFacts(message)).toEqual({ kind: 'needs-facts' });
  });
});
