/**
 * A VUE facts RAG evaluation. Read-only: it embeds eval questions and runs the same
 * parameterised vector SELECT as retrieval, without the provisional distance threshold.
 * Output contains case ids, closed-set variant labels and numbers only.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allQueriesReturnedNoRows,
  distanceDistribution,
  EVAL_VARIANTS,
  isPositiveVariant,
  metricForCase,
  suggestThreshold,
  summariseHits,
  validateEvalCases,
  type CaseMetric,
  type EvalCase,
  type EvalDistanceRow,
} from '../src/lib/rag/eval.js';
import { chunkMarkdown } from '../src/lib/rag/chunker.js';
import { retrieveRawFactChunks, TOP_K } from '../src/lib/rag/retrieve.js';

const EVAL_CASES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/rag/eval-cases.json',
);
const FACTS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/rag/avue-facts.md',
);
/** Eval needs the full ordered corpus so expected-chunk rank is visible. */
export const EVAL_ROW_LIMIT = 20;

export type RagEvalDeps = {
  readCases(): EvalCase[];
  retrieve(query: string): Promise<EvalDistanceRow[]>;
};

export function loadEvalCases(): EvalCase[] {
  const headings = new Set(chunkMarkdown(readFileSync(FACTS_FILE, 'utf8')).map((chunk) => chunk.heading));
  const parsed: unknown = JSON.parse(readFileSync(EVAL_CASES_FILE, 'utf8'));
  const errors = validateEvalCases(parsed, headings);
  if (errors.length > 0) {
    throw new Error(`RAG_EVAL_CASES_INVALID:${errors.length}`);
  }
  return parsed as EvalCase[];
}

async function retrieveForEval(query: string): Promise<EvalDistanceRow[]> {
  const rows = await retrieveRawFactChunks(query, { limit: EVAL_ROW_LIMIT });
  return rows.map((row) => ({ heading: row.heading, distance: row.distance }));
}

const defaultDeps: RagEvalDeps = {
  readCases: loadEvalCases,
  retrieve: retrieveForEval,
};

function numberOrNone(value: number | null): string {
  return value === null ? 'none' : value.toFixed(4);
}

export async function runRagEval(deps: RagEvalDeps = defaultDeps): Promise<void> {
  const cases = deps.readCases();
  const metrics: CaseMetric[] = [];
  for (const testCase of cases) {
    const rows = await deps.retrieve(testCase.query);
    metrics.push(metricForCase(testCase, rows));
  }

  // An empty corpus or a wrong source_file filter must never look like a threshold result.
  if (allQueriesReturnedNoRows(metrics)) {
    process.stdout.write('no rows returned: check source_file filter and ingest\n');
    process.exitCode = 1;
    return;
  }

  for (const metric of metrics) {
    const expected = numberOrNone(metric.expectedDistance);
    process.stdout.write(
      `case=${metric.id} variant=${metric.variant} rank=${numberOrNone(metric.rank)} ` +
        `best=${numberOrNone(metric.bestDistance)} expected=${expected}\n`,
    );
  }

  for (const summary of summariseHits(metrics, TOP_K)) {
    process.stdout.write(
      `hit@1 variant=${summary.variant} hits=${summary.hitsAt1}/${summary.count}\n`,
    );
    process.stdout.write(
      `hit@K K=${TOP_K} variant=${summary.variant} hits=${summary.hitsAtK}/${summary.count}\n`,
    );
  }

  const negatives = metrics.filter((metric) => metric.variant === 'negative');
  const negativeDistribution = distanceDistribution(
    negatives.map((metric) => metric.bestDistance ?? Number.NaN),
  );
  process.stdout.write(
    `negatives count=${negativeDistribution.count} minBest=${numberOrNone(negativeDistribution.min)} ` +
      `maxBest=${numberOrNone(negativeDistribution.max)} meanBest=${numberOrNone(negativeDistribution.mean)}\n`,
  );

  const positives = metrics.filter((metric) => isPositiveVariant(metric.variant));
  const suggestion = suggestThreshold(
    positives.map((metric) => metric.expectedDistance ?? Number.NaN),
    negatives.map((metric) => metric.bestDistance ?? Number.NaN),
  );
  if (suggestion.suggestedMaxDistance === null) {
    process.stdout.write(
      `recommendation overlap=${suggestion.overlap.toFixed(4)} ` +
        `maxPositive=${numberOrNone(suggestion.maxPositive)} ` +
        `minNegative=${numberOrNone(suggestion.minNegative)}\n`,
    );
  } else {
    process.stdout.write(
      `recommendation suggestedMaxDistance=${suggestion.suggestedMaxDistance.toFixed(4)} ` +
        `maxPositive=${numberOrNone(suggestion.maxPositive)} ` +
        `minNegative=${numberOrNone(suggestion.minNegative)}\n`,
    );
  }
  process.stdout.write(`variants=${EVAL_VARIANTS.join(',')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRagEval().catch((error: unknown) => {
    process.stderr.write(`rag_eval_error=${error instanceof Error ? error.name : 'Error'}\n`);
    process.exitCode = 1;
  });
}
