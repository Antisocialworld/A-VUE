import { describe, expect, it } from 'vitest';
import { checkScope, normaliseBrand, SCOPE_REFUSAL_TEXT } from '../lib/assistant/scopeGuard.js';

describe('scopeGuard', () => {
  it('exports fixed refusal text', () => {
    expect(SCOPE_REFUSAL_TEXT).toBe(
      'I can only help with A VUE, our cinema. Ask me about showtimes, tickets, policies or opening hours.',
    );
  });

  describe('normaliseBrand', () => {
    const cases: Array<[string, string]> = [
      ['avue', 'A VUE'],
      ['AVUE', 'A VUE'],
      ['A-vue', 'A VUE'],
      ['a_vue', 'A VUE'],
      ['a vue', 'A VUE'],
      ['A VUE showtimes', 'A VUE showtimes'],
      ['a view tonight?', 'A VUE tonight?'],
      ['whats on at avue', 'whats on at A VUE'],
    ];

    it.each(cases)('normalises %j to %j', (input, expected) => {
      expect(normaliseBrand(input)).toBe(expected);
    });
  });

  describe('checkScope ok/unchanged cases', () => {
    const okUnchanged = [
      'what time is the late show',
      'nice view from the seats',
      'review of the film',
    ];

    it.each(okUnchanged)('returns ok and leaves text unchanged for %j', (input) => {
      expect(checkScope(input)).toEqual({ kind: 'ok' });
      expect(normaliseBrand(input)).toBe(input);
    });

    it('treats brand variants as ok', () => {
      expect(checkScope('avue')).toEqual({ kind: 'ok' });
      expect(checkScope('A-vue')).toEqual({ kind: 'ok' });
      expect(checkScope('a view tonight?')).toEqual({ kind: 'ok' });
    });
  });

  describe('checkScope other-vue cases', () => {
    const otherVue = [
      'how do I use Vue.js',
      'vuejs router',
      'vue 3 composition api',
      'Vuex store',
      'Pinia vs Vuex',
      'Nuxt',
      'vue cinemas near me',
      'tell me about vue',
    ];

    it.each(otherVue)('returns other-vue for %j', (input) => {
      expect(checkScope(input)).toEqual({ kind: 'other-vue' });
    });
  });
});
