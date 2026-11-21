import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../lib/rag/chunker.js';
import {
  allQueriesReturnedNoRows,
  distanceDistribution,
  groupByVariant,
  metricForCase,
  missingPositiveVariants,
  rankExpected,
  suggestThreshold,
  summariseHits,
  validateEvalCases,
  type CaseMetric,
  type EvalCase,
} from '../lib/rag/eval.js';

const serverRoot = path.resolve(__dirname, '../..');
const factsPath = path.resolve(serverRoot, 'data/rag/avue-facts.md');
const casesPath = path.resolve(serverRoot, 'data/rag/eval-cases.json');
const scriptPath = path.resolve(serverRoot, 'scripts/eval-rag.ts');
const ingestScriptPath = path.resolve(serverRoot, 'scripts/ingest-rag.ts');
const retrievePath = path.resolve(serverRoot, 'src/lib/rag/retrieve.ts');

const headings = new Set(chunkMarkdown(fs.readFileSync(factsPath, 'utf8')).map((chunk) => chunk.heading));
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8')) as EvalCase[];

function metric(
  id: string,
  variant: CaseMetric['variant'],
  rank: number | null,
  bestDistance: number,
  expectedDistance: number | null,
): CaseMetric {
  return { id, variant, rank, bestDistance, expectedDistance };
}

describe('Task 4: pure RAG eval metrics', () => {
  it('ranks the expected heading from the ordered raw rows', () => {
    const rows = [
      { heading: 'first', distance: 0.1 },
      { heading: 'expected', distance: 0.2 },
    ];
    expect(rankExpected(rows, 'expected')).toBe(2);
    expect(rankExpected(rows, 'missing')).toBeNull();
    expect(rankExpected(rows, null)).toBeNull();
  });

  it('builds a metric with best and expected distances', () => {
    const result = metricForCase(
      { id: 'case-1', query: 'q', expectedHeading: 'b', variant: 'normal' },
      [
        { heading: 'a', distance: 0.1 },
        { heading: 'b', distance: 0.3 },
      ],
    );
    expect(result).toEqual({
      id: 'case-1',
      variant: 'normal',
      rank: 2,
      bestDistance: 0.1,
      expectedDistance: 0.3,
    });
  });

  it('groups by variant and summarises hit@1 and hit@K', () => {
    const metrics = [
      metric('a', 'normal', 1, 0.1, 0.1),
      metric('b', 'normal', 3, 0.2, 0.4),
      metric('c', 'typo', null, 0.5, null),
      metric('d', 'short', 2, 0.1, 0.3),
      metric('e', 'incomplete', 4, 0.1, 0.5),
      metric('f', 'negative', null, 0.7, null),
    ];
    const grouped = groupByVariant(metrics);
    expect(grouped.normal).toHaveLength(2);
    expect(grouped.negative).toHaveLength(1);

    const summaries = summariseHits(metrics, 4);
    const normal = summaries.find((entry) => entry.variant === 'normal');
    expect(normal).toEqual({ variant: 'normal', count: 2, hitsAt1: 1, hitsAtK: 2 });
    expect(summaries.find((entry) => entry.variant === 'negative')).toBeUndefined();
  });

  it('computes negative distance distribution', () => {
    const distribution = distanceDistribution([0.2, 0.4, 0.6]);
    expect(distribution.count).toBe(3);
    expect(distribution.min).toBe(0.2);
    expect(distribution.max).toBe(0.6);
    expect(distribution.mean).toBeCloseTo(0.4, 10);
    expect(distanceDistribution([]).min).toBeNull();
  });

  it('suggests a midpoint only when positives and negatives separate', () => {
    expect(suggestThreshold([0.2, 0.4], [0.6, 0.8])).toEqual({
      maxPositive: 0.4,
      minNegative: 0.6,
      suggestedMaxDistance: 0.5,
      overlap: 0,
    });
    const overlapping = suggestThreshold([0.1, 0.7], [0.5, 0.9]);
    expect(overlapping.maxPositive).toBe(0.7);
    expect(overlapping.minNegative).toBe(0.5);
    expect(overlapping.suggestedMaxDistance).toBeNull();
    expect(overlapping.overlap).toBeCloseTo(0.2, 10);
  });
});

describe('Task 4: eval case file', () => {
  it('validates every expected heading against the ingested facts file', () => {
    expect(validateEvalCases(cases, headings)).toEqual([]);
  });

  it('has all four positive variants for every fact heading', () => {
    expect(missingPositiveVariants(cases, headings)).toEqual([]);
    expect(headings.size).toBe(8);
    const positives = cases.filter((testCase) => testCase.expectedHeading !== null);
    for (const heading of headings) {
      expect(
        positives.filter((testCase) => testCase.expectedHeading === heading).length,
      ).toBeGreaterThanOrEqual(7);
    }
    expect(cases.filter((testCase) => testCase.variant === 'negative').length).toBeGreaterThanOrEqual(25);
  });
});

describe('Task 4: read-only script', () => {
  it('never writes to the database and never ingests eval cases', () => {
    const script = fs.readFileSync(scriptPath, 'utf8');
    const ingest = fs.readFileSync(ingestScriptPath, 'utf8');
    const retrieve = fs.readFileSync(retrievePath, 'utf8');

    expect(script).toContain('retrieveRawFactChunks');
    expect(script).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(script).not.toContain('writerPool');
    expect(script).not.toContain('writeRagChunks');
    // Inspect only executed SQL literals: `.update(...)` on a hash is not a write statement.
    const sqlStatements = Array.from(
      retrieve.matchAll(/readerPool\.query(?:<[^>]*>)?\(\s*`([\s\S]*?)`/g),
      (match) => match[1],
    );
    expect(sqlStatements.length).toBeGreaterThan(0);
    for (const sql of sqlStatements) {
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    }
    expect(sqlStatements[0]).toContain('SELECT heading, content');
    expect(script).toContain('no rows returned: check source_file filter and ingest');
    expect(ingest).toContain('data/rag/avue-facts.md');
    expect(ingest).not.toContain('eval-cases.json');
  });
});

describe('Task 4: empty-result guard', () => {
  it('flags a non-empty run where every query had zero rows, and nothing else', () => {
    const empty = (id: string): CaseMetric => ({
      id,
      variant: 'negative',
      rank: null,
      bestDistance: null,
      expectedDistance: null,
    });

    expect(allQueriesReturnedNoRows([])).toBe(false);
    expect(allQueriesReturnedNoRows([empty('a'), empty('b')])).toBe(true);
    expect(
      allQueriesReturnedNoRows([
        metric('a', 'normal', 1, 0.1, 0.1),
        empty('b'),
      ]),
    ).toBe(false);
  });
});
