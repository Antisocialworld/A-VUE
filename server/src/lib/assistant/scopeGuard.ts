export const SCOPE_REFUSAL_TEXT =
  'I can only help with A VUE, our cinema. Ask me about showtimes, tickets, policies or opening hours.';

function replaceBrandVariants(input: string): string {
  let s = input;
  // Handle common forms: a vue, a-vue, a_vue, a.vue, avue, a view, aview (with optional spaces)
  s = s.replace(/\ba[\s._-]*vue\b/gi, 'A VUE');
  s = s.replace(/\ba[\s._-]*view\b/gi, 'A VUE');
  return s;
}

export function normaliseBrand(text: string): string {
  if (!text) return text;
  // Normalize unicode whitespace lightly and run replacements
  return replaceBrandVariants(text);
}

export function checkScope(text: string): { kind: 'ok' } | { kind: 'other-vue' } {
  const normalized = normaliseBrand(text);

  // After normalization, "A VUE" represents brand; any other standalone/vue-like tokens indicate other-vue.
  // Remove brand occurrences so we only inspect other mentions.
  const withoutBrand = normalized.replace(/\bA VUE\b/g, '');

  // Check for other "vue" variants (vue.js, vuejs, "vue js", vue3, Vuex, Pinia, Nuxt, "Vue Cinemas", "vue cinema")
  const otherVuePatterns: RegExp[] = [
    /\bvue\.js\b/i,
    /\bvuejs\b/i,
    /\bvue\s*js\b/i,
    /\bvue\s*3\b/i,
    /\bvuex\b/i,
    /\bpinia\b/i,
    /\bnuxt\b/i,
    /\bvue\s+cinemas?\b/i,
  ];

  for (const re of otherVuePatterns) {
    if (re.test(withoutBrand)) {
      return { kind: 'other-vue' };
    }
  }

  // Any remaining standalone "vue" token (not part of A VUE) is other-vue
  if (/\bvue\b/i.test(withoutBrand)) {
    return { kind: 'other-vue' };
  }

  return { kind: 'ok' };
}
