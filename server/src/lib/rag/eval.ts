/** Pure metrics and schema helpers for the A VUE facts RAG eval. */

export const EVAL_VARIANTS = ['normal', 'typo', 'short', 'incomplete'] as const;
export type EvalVariant = (typeof EVAL_VARIANTS)[number] | 'negative';

export type EvalCase = {
  id: string;
  query: string;
  expectedHeading: string | null;
  variant: EvalVariant;
};

export type EvalDistanceRow = {
  heading: string;
  distance: number;
};

export type CaseMetric = {
  id: string;
  variant: EvalVariant;
  rank: number | null;
  bestDistance: number | null;
  expectedDistance: number | null;
};

const POSITIVE_VARIANTS: ReadonlySet<string> = new Set(EVAL_VARIANTS);

/** Pure guard: true only for a non-empty run where every query returned zero rows. */
export function allQueriesReturnedNoRows(metrics: CaseMetric[]): boolean {
  return metrics.length > 0 && metrics.every((metric) => metric.bestDistance === null);
}

export function isPositiveVariant(variant: EvalVariant): boolean {
  return POSITIVE_VARIANTS.has(variant);
}

/** One-based rank of the expected heading in the ordered raw rows. */
export function rankExpected(rows: EvalDistanceRow[], expectedHeading: string | null): number | null {
  if (!expectedHeading) return null;
  const index = rows.findIndex((row) => row.heading === expectedHeading);
  return index < 0 ? null : index + 1;
}

export function bestDistance(rows: EvalDistanceRow[]): number | null {
  return rows.length === 0 ? null : rows[0].distance;
}

export function expectedDistance(rows: EvalDistanceRow[], expectedHeading: string | null): number | null {
  const rank = rankExpected(rows, expectedHeading);
  return rank === null ? null : rows[rank - 1].distance;
}

export function metricForCase(testCase: EvalCase, rows: EvalDistanceRow[]): CaseMetric {
  return {
    id: testCase.id,
    variant: testCase.variant,
    rank: rankExpected(rows, testCase.expectedHeading),
    bestDistance: bestDistance(rows),
    expectedDistance: expectedDistance(rows, testCase.expectedHeading),
  };
}

export function groupByVariant(metrics: CaseMetric[]): Record<EvalVariant, CaseMetric[]> {
  const grouped: Record<EvalVariant, CaseMetric[]> = {
    normal: [],
    typo: [],
    short: [],
    incomplete: [],
    negative: [],
  };
  for (const metric of metrics) grouped[metric.variant].push(metric);
  return grouped;
}

export type VariantSummary = {
  variant: EvalVariant;
  count: number;
  hitsAt1: number;
  hitsAtK: number;
};

/** Hit rates are computed over positive cases only; negatives use distance distribution. */
export function summariseHits(metrics: CaseMetric[], k: number): VariantSummary[] {
  const grouped = groupByVariant(metrics.filter((metric) => isPositiveVariant(metric.variant)));
  return EVAL_VARIANTS.map((variant) => {
    const rows = grouped[variant];
    return {
      variant,
      count: rows.length,
      hitsAt1: rows.filter((metric) => metric.rank === 1).length,
      hitsAtK: rows.filter((metric) => metric.rank !== null && metric.rank <= k).length,
    };
  });
}

export type DistanceDistribution = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
};

export function distanceDistribution(values: number[]): DistanceDistribution {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { count: 0, min: null, max: null, mean: null };
  return {
    count: finite.length,
    min: Math.min(...finite),
    max: Math.max(...finite),
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
  };
}

export type ThresholdSuggestion = {
  maxPositive: number | null;
  minNegative: number | null;
  suggestedMaxDistance: number | null;
  overlap: number;
};

/**
 * Compares the largest expected-chunk distance among positives with the smallest best
 * distance among negatives. A midpoint is suggested only when the two sets separate.
 */
export function suggestThreshold(
  positiveExpectedDistances: number[],
  negativeBestDistances: number[],
): ThresholdSuggestion {
  const positives = positiveExpectedDistances.filter((value) => Number.isFinite(value));
  const negatives = negativeBestDistances.filter((value) => Number.isFinite(value));
  if (positives.length === 0 || negatives.length === 0) {
    return {
      maxPositive: positives.length > 0 ? Math.max(...positives) : null,
      minNegative: negatives.length > 0 ? Math.min(...negatives) : null,
      suggestedMaxDistance: null,
      overlap: 0,
    };
  }

  const maxPositive = Math.max(...positives);
  const minNegative = Math.min(...negatives);
  if (maxPositive < minNegative) {
    return {
      maxPositive,
      minNegative,
      suggestedMaxDistance: (maxPositive + minNegative) / 2,
      overlap: 0,
    };
  }
  return {
    maxPositive,
    minNegative,
    suggestedMaxDistance: null,
    overlap: maxPositive - minNegative,
  };
}

export function validateEvalCases(
  value: unknown,
  headings: Set<string>,
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) return ['cases must be an array'];

  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      errors.push(`case ${index}: not an object`);
      continue;
    }
    const testCase = item as Partial<EvalCase>;
    if (typeof testCase.id !== 'string' || !testCase.id) errors.push(`case ${index}: bad id`);
    else if (ids.has(testCase.id)) errors.push(`duplicate id ${testCase.id}`);
    else ids.add(testCase.id);

    if (typeof testCase.query !== 'string' || !testCase.query) {
      errors.push(`case ${testCase.id ?? index}: bad query`);
    }
    if (
      testCase.variant !== 'normal' &&
      testCase.variant !== 'typo' &&
      testCase.variant !== 'short' &&
      testCase.variant !== 'incomplete' &&
      testCase.variant !== 'negative'
    ) {
      errors.push(`case ${testCase.id ?? index}: bad variant`);
    }
    if (testCase.expectedHeading === null) {
      if (testCase.variant !== 'negative') {
        errors.push(`case ${testCase.id ?? index}: null heading on positive case`);
      }
    } else if (typeof testCase.expectedHeading !== 'string' || !headings.has(testCase.expectedHeading)) {
      errors.push(`case ${testCase.id ?? index}: unknown heading`);
    }
  }
  return errors;
}

export function missingPositiveVariants(cases: EvalCase[], headings: Set<string>): string[] {
  const missing: string[] = [];
  for (const heading of headings) {
    const present = new Set(
      cases
        .filter((testCase) => testCase.expectedHeading === heading)
        .map((testCase) => testCase.variant),
    );
    for (const variant of EVAL_VARIANTS) {
      if (!present.has(variant)) missing.push(`${heading}:${variant}`);
    }
  }
  return missing;
}
