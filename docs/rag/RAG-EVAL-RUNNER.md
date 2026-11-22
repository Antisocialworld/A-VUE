# RAG eval runner and Vitest tests

Create these files exactly as shown. Node 20 or newer, no other dependency except Vitest for the test file.

## Layout

```
rag-eval/
  data/rag-chunks.md            <- the file rag-chunks.md
  tests/eval/questions.json     <- the JSON block at the end of rag-evals.md
  score.mjs
  run.mjs
  adapters/http.mjs
  adapters/oracle.mjs
  adapters/wrong.mjs
  tests/rag.eval.test.mjs
  package.json
```

## Run

Self-test, no RAG needed (expect 59/59):

```
node run.mjs --adapter ./adapters/oracle.mjs --min 1
```

Against your RAG over HTTP:

```
RAG_URL=http://localhost:3000/rag/ask node run.mjs --verbose
```

Vitest (the eval tests run when `RAG_URL` is set, otherwise they show as skipped):

```
npm install
npm test
RAG_URL=http://localhost:3000/rag/ask npm test
```

Adapter settings (environment variables): `RAG_URL` (required), `RAG_QUESTION_FIELD` (default `question`), `RAG_ANSWER_PATH` (default `answer`), `RAG_SOURCES_PATH` (default `sources`; strings or objects with `id`, `chunk_id`, `slug`), `RAG_AUTH_HEADER_NAME`, `RAG_AUTH_HEADER_VALUE`. Runner flags: `--adapter`, `--questions`, `--min` (default 0.8), `--concurrency`, `--timeout`, `--require-sources`, `--json`, `--verbose`.

Never put a real key in a file or a command you share. The auth value is read from the environment and is never printed.

## `score.mjs`

Scoring. Matches whole tokens, handles yes/no answers, checks sources by id, slug, chunk id or FAQ id.

```js
import fs from 'node:fs';
import path from 'node:path';

export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/[^a-z0-9:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NO_WORDS = /(^| )(no|not|never|cannot|can t|doesn t|isn t|aren t)( |$)/;
const YES_WORDS = /(^| )yes( |$)/;
// "I do not know", "not sure", "no information" are not an answer of "no".
const UNSURE = /(do not|don t|did not|didn t|cannot|can t|could not|couldn t|unable to|not able to) (know|find|say|tell|determine|answer)|not sure|unsure|unclear|no information|no data|no idea|no record/;

// True when `item` appears in `text` as a whole token sequence.
// Items "no" and "yes" are answer polarity: "no" needs a negative word and no "yes".
export function hasItem(text, item) {
  const h = norm(text);
  const i = norm(item);
  if (!i) return false;
  if (i === 'no') return NO_WORDS.test(h) && !YES_WORDS.test(h) && !UNSURE.test(h);
  if (i === 'yes') return YES_WORDS.test(h) && !NO_WORDS.test(h);
  return new RegExp('(?<![a-z0-9:])' + escapeRe(i) + '(?![a-z0-9:])').test(h);
}

export function expectedDocs(q) {
  if (Array.isArray(q.expected_docs)) return q.expected_docs.map((d) => ({ id: d.id, slug: d.slug, alt: d.alt ?? [] }));
  const ids = q.movie_ids ?? q.doc_ids ?? [];
  const slugs = q.movie_slugs ?? [];
  return ids.map((id, i) => ({ id, slug: slugs[i], alt: [] }));
}

function sourceKeys(sources) {
  const out = new Set();
  for (const s of Array.isArray(sources) ? sources : []) {
    const add = (v) => {
      const k = String(v).toLowerCase();
      out.add(k);
      if (k.includes('#')) out.add(k.split('#')[0]); // chunk id "mv-001#plot" also counts as document "mv-001"
    };
    if (typeof s === 'string') add(s);
    else if (s && typeof s === 'object') {
      for (const k of ['id', 'chunk_id', 'slug', 'documentId', 'doc_id']) if (s[k]) add(s[k]);
    }
  }
  return out;
}

// result: { answer: string, sources?: (string | {id|slug|documentId|doc_id})[] }
export function scoreAnswer(q, result, opts = {}) {
  const maxChars = opts.maxAnswerChars ?? 800;
  const answer = typeof result?.answer === 'string' ? result.answer : '';
  const items = q.must_include && q.must_include.length ? q.must_include : [q.answer];
  const missing = items.filter((it) => !hasItem(answer, it));
  const tooLong = answer.length > maxChars;
  const keys = sourceKeys(result?.sources);
  let retrieval = null;
  let missingDocs = [];
  if (keys.size) {
    missingDocs = expectedDocs(q)
      .filter(
        (d) =>
          !keys.has(String(d.id).toLowerCase()) &&
          !(d.slug && keys.has(String(d.slug).toLowerCase())) &&
          !d.alt.some((a) => keys.has(String(a).toLowerCase())),
      )
      .map((d) => d.id);
    retrieval = missingDocs.length === 0;
  }
  const answerOk = answer.trim().length > 0 && missing.length === 0 && !tooLong;
  const pass = answerOk && (!opts.requireSources || retrieval === true);
  return { pass, answerOk, retrieval, missing, missingDocs, tooLong };
}

// p: path to tests/eval/questions.json (preferred), or a folder holding the two legacy .jsonl files.
export function loadQuestions(p) {
  if (p.endsWith('.json')) return JSON.parse(fs.readFileSync(p, 'utf8')).questions;
  const dir = p;
  const files = [
    ['movies', 'eval_questions.jsonl'],
    ['cinema', 'eval_questions_cinema.jsonl'],
  ];
  const out = [];
  for (const [set, name] of files) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (line.trim()) out.push({ ...JSON.parse(line), set });
    }
  }
  return out;
}

export function summarize(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.score.pass).length;
  const withRetrieval = rows.filter((r) => r.score.retrieval !== null);
  const retrievalHits = withRetrieval.filter((r) => r.score.retrieval).length;
  const bySet = {};
  for (const r of rows) {
    const s = (bySet[r.q.set] ??= { total: 0, passed: 0 });
    s.total += 1;
    if (r.score.pass) s.passed += 1;
  }
  return {
    total,
    passed,
    passRate: total ? passed / total : 0,
    retrievalChecked: withRetrieval.length,
    retrievalHits,
    bySet,
  };
}
```

## `run.mjs`

Command-line runner. Prints PASS or FAIL per question, a summary and retrieval stats. Exit code 1 below the threshold.

```js
#!/usr/bin/env node
// Usage: node run.mjs [--adapter ./adapters/http.mjs] [--questions tests/eval/questions.json] [--min 0.8]
//        [--concurrency 4] [--timeout 30000] [--require-sources] [--json out.json] [--verbose]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadQuestions, scoreAnswer, summarize } from './score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const val = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};

const adapterPath = path.resolve(here, val('adapter', './adapters/http.mjs'));
const questionsDir = path.resolve(here, val('questions', './tests/eval/questions.json'));
const minRate = Number(val('min', '0.8'));
const concurrency = Math.max(1, Number(val('concurrency', '4')));
const timeoutMs = Number(val('timeout', '30000'));
const requireSources = flag('require-sources');
const verbose = flag('verbose');
const jsonOut = val('json', '');

const { ask } = await import(pathToFileURL(adapterPath).href);
const questions = loadQuestions(questionsDir);
if (!questions.length) {
  console.error('No questions found at ' + questionsDir);
  process.exit(2);
}

function withTimeout(p, ms) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error('timeout after ' + ms + ' ms')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

const rows = new Array(questions.length);
let next = 0;
async function worker() {
  while (next < questions.length) {
    const idx = next++;
    const q = questions[idx];
    let result = null;
    let error = null;
    try {
      result = await withTimeout(Promise.resolve(ask(q.question, { q })), timeoutMs);
    } catch (e) {
      error = String(e && e.message ? e.message : e);
    }
    const score = error
      ? { pass: false, answerOk: false, retrieval: null, missing: q.must_include ?? [q.answer], missingDocs: [], tooLong: false }
      : scoreAnswer(q, result, { requireSources });
    rows[idx] = { q, result, score, error };
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, questions.length) }, worker));

for (const r of rows) {
  const tag = r.score.pass ? 'PASS' : 'FAIL';
  let why = '';
  if (r.error) why = ' error: ' + r.error;
  else if (!r.score.pass) {
    const bits = [];
    if (r.score.missing.length) bits.push('missing ' + JSON.stringify(r.score.missing));
    if (r.score.tooLong) bits.push('answer too long');
    if (requireSources && r.score.retrieval !== true) bits.push('sources ' + (r.score.retrieval === null ? 'not returned' : 'missing ' + JSON.stringify(r.score.missingDocs)));
    why = ' ' + bits.join('; ');
  }
  console.log(tag + ' ' + r.q.id + ' ' + r.q.question + why);
  if (verbose && r.result) console.log('     answer: ' + String(r.result.answer).slice(0, 300));
}

const s = summarize(rows);
console.log('\n' + s.passed + '/' + s.total + ' passed (' + (s.passRate * 100).toFixed(1) + '%), threshold ' + (minRate * 100).toFixed(0) + '%');
for (const [k, v] of Object.entries(s.bySet)) console.log('  ' + k + ': ' + v.passed + '/' + v.total);
if (s.retrievalChecked) console.log('retrieval: ' + s.retrievalHits + '/' + s.retrievalChecked + ' questions had all expected documents in sources');
else console.log('retrieval: not checked (adapter returned no sources)');

if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      { summary: s, rows: rows.map((r) => ({ id: r.q.id, set: r.q.set, pass: r.score.pass, retrieval: r.score.retrieval, missing: r.score.missing, error: r.error })) },
      null,
      2,
    ),
  );
}
process.exit(s.passRate >= minRate ? 0 : 1);
```

## `adapters/http.mjs`

The one file to change for your RAG API. Configured by environment variables.

```js
// The ONE file to change if your RAG API has a different shape.
// Configure with environment variables (nothing is hard-coded, nothing secret is ever printed):
//   RAG_URL                  required, full URL of the question endpoint
//   RAG_QUESTION_FIELD       JSON field that carries the question        (default "question")
//   RAG_ANSWER_PATH          dot path to the answer text in the response (default "answer")
//   RAG_SOURCES_PATH         dot path to the list of source ids/slugs    (default "sources", optional)
//   RAG_AUTH_HEADER_NAME     header name for auth                        (default "Authorization")
//   RAG_AUTH_HEADER_VALUE    header value for auth                       (optional)
// Sources may be strings or objects with id, slug, documentId or doc_id.

function getPath(obj, p) {
  return String(p)
    .split('.')
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export async function ask(question) {
  const url = process.env.RAG_URL;
  if (!url) throw new Error('RAG_URL is not set');
  const headers = { 'content-type': 'application/json' };
  if (process.env.RAG_AUTH_HEADER_VALUE) {
    headers[process.env.RAG_AUTH_HEADER_NAME || 'Authorization'] = process.env.RAG_AUTH_HEADER_VALUE;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ [process.env.RAG_QUESTION_FIELD || 'question']: question }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  const answer = getPath(json, process.env.RAG_ANSWER_PATH || 'answer');
  const sources = getPath(json, process.env.RAG_SOURCES_PATH || 'sources');
  return { answer: typeof answer === 'string' ? answer : JSON.stringify(answer ?? ''), sources };
}
```

## `adapters/oracle.mjs`

Self-test only. Returns the expected answers, so the runner must score 100 percent.

```js
// SELF-TEST ONLY. Cheats by returning the expected answer, so the runner should score 100%.
// It proves the runner and scorer work; it says nothing about your RAG system.
export async function ask(_question, ctx) {
  const q = ctx.q;
  return { answer: q.answer, sources: (q.expected_docs ?? []).map((d) => d.id) };
}
```

## `adapters/wrong.mjs`

Self-test only. Always wrong, so the runner must score near 0 percent.

```js
// SELF-TEST ONLY. Always answers wrongly, so the runner should score 0% and exit 1.
export async function ask() {
  return { answer: 'I do not know.', sources: [] };
}
```

## `tests/rag.eval.test.mjs`

Vitest file. Unit tests for the scorer, checks on the eval file, and one test per eval question (runs when RAG_URL is set).

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, hasItem, scoreAnswer, loadQuestions } from '../score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalFile = path.join(here, 'eval', 'questions.json');
const chunksFile = process.env.RAG_CHUNKS_FILE || path.join(here, '..', 'data', 'rag-chunks.md');
const evalDoc = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
const questions = loadQuestions(evalFile);

// Parse the chunk cards: "## CHUNK <id>" then a header line "type: .. | source: .. | slug: .. | words: .."
function readChunks() {
  const text = fs.readFileSync(chunksFile, 'utf8');
  const chunks = [];
  const re = /^## CHUNK (\S+)\n([^\n]*)\n/gm;
  let m;
  while ((m = re.exec(text))) {
    const meta = Object.fromEntries(m[2].split(' | ').map((kv) => kv.split(': ')));
    chunks.push({ id: m[1], ...meta });
  }
  return chunks;
}

describe('scorer', () => {
  it('normalises punctuation, case, accents, ampersands and thousands separators', () => {
    expect(norm('Marrow & Bone')).toBe('marrow and bone');
    expect(norm('Amélie')).toBe('amelie');
    expect(norm('₦5,500')).toBe('5500');
  });
  it('matches whole tokens only', () => {
    expect(hasItem('It opens at 10:00 on Sunday.', '10:00')).toBe(true);
    expect(hasItem('It opens at 110:00', '10:00')).toBe(false);
    expect(hasItem('Up to 16 seats', '6')).toBe(false);
    expect(hasItem('At most 6 seats', '6')).toBe(true);
  });
  it('treats "no" as a polarity check', () => {
    expect(hasItem('No, it does not.', 'no')).toBe(true);
    expect(hasItem('It does not show that film.', 'no')).toBe(true);
    expect(hasItem('Yes, it shows it.', 'no')).toBe(false);
    expect(hasItem('No, yes maybe', 'no')).toBe(false);
    expect(hasItem('I do not know.', 'no')).toBe(false);
    expect(hasItem('I am not sure about that.', 'no')).toBe(false);
    expect(hasItem('There is no information about it.', 'no')).toBe(false);
    expect(hasItem('No.', 'no')).toBe(true);
  });
  it('passes a correct answer, fails a wrong one and an empty one', () => {
    const q = { id: 'x', answer: 'Kenji Arakawa', must_include: ['Kenji Arakawa'] };
    expect(scoreAnswer(q, { answer: 'It was directed by Kenji Arakawa.' }).pass).toBe(true);
    expect(scoreAnswer(q, { answer: 'Ines Marlowe' }).pass).toBe(false);
    expect(scoreAnswer(q, { answer: '' }).pass).toBe(false);
  });
  it('rejects a near-title: Harbor vs Harbour', () => {
    const q = { id: 'x', answer: 'Harbour Lights', must_include: ['Harbour Lights'] };
    expect(scoreAnswer(q, { answer: 'Harbor Lights' }).pass).toBe(false);
  });
  it('fails an answer that dumps too much text', () => {
    const q = { id: 'x', answer: 'A', must_include: ['A'] };
    expect(scoreAnswer(q, { answer: 'A ' + 'filler '.repeat(200) }).pass).toBe(false);
  });
  it('checks retrieval by id, slug or FAQ entry, and is null when no sources are returned', () => {
    const q = { id: 'x', answer: 'A', must_include: ['A'], expected_docs: [{ id: 'mv-002', slug: 'harbour-lights-2019', alt: ['faq-007'] }] };
    expect(scoreAnswer(q, { answer: 'A', sources: ['mv-002'] }).retrieval).toBe(true);
    expect(scoreAnswer(q, { answer: 'A', sources: [{ slug: 'harbour-lights-2019' }] }).retrieval).toBe(true);
    expect(scoreAnswer(q, { answer: 'A', sources: ['faq-007'] }).retrieval).toBe(true);
    expect(scoreAnswer(q, { answer: 'A', sources: ['mv-001'] }).retrieval).toBe(false);
    expect(scoreAnswer(q, { answer: 'A' }).retrieval).toBe(null);
    expect(scoreAnswer(q, { answer: 'A', sources: ['mv-001'] }, { requireSources: true }).pass).toBe(false);
  });
});

describe('eval file (tests/eval/questions.json)', () => {
  it('declares the right count and gives every question a question, an answer and expected docs', () => {
    expect(questions.length).toBe(evalDoc.count);
    expect(questions.length).toBeGreaterThan(50);
    for (const q of questions) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.answer.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(q.must_include) && q.must_include.length > 0).toBe(true);
      expect(q.expected_docs.length).toBeGreaterThan(0);
    }
  });
  it('has unique ids and every expected answer scores itself as a pass', () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const q of questions) {
      expect(scoreAnswer(q, { answer: q.answer, sources: q.expected_docs.map((d) => d.id) }).pass).toBe(true);
    }
  });
  it('only expects documents and FAQ entries that exist in the chunk file', () => {
    const chunks = readChunks();
    const sources = new Set(chunks.map((c) => c.source));
    const ids = new Set(chunks.map((c) => c.id));
    expect(chunks.length).toBeGreaterThan(200);
    for (const q of questions) {
      for (const d of q.expected_docs) {
        expect(sources.has(d.id)).toBe(true);
        for (const a of d.alt) expect(ids.has(a)).toBe(true);
      }
    }
  });
  it('resolves every chunk id returned by a RAG back to its document', () => {
    const q = { id: 'x', answer: 'A', must_include: ['A'], expected_docs: [{ id: 'mv-001', slug: 'harbor-lights-1998', alt: [] }] };
    expect(scoreAnswer(q, { answer: 'A', sources: ['mv-001#plot'] }).retrieval).toBe(true);
    expect(scoreAnswer(q, { answer: 'A', sources: [{ chunk_id: 'mv-002#plot' }] }).retrieval).toBe(false);
  });
  it('does not reuse an eval question as an FAQ question', () => {
    const text = fs.readFileSync(chunksFile, 'utf8');
    const faqQs = new Set([...text.matchAll(/^Q: (.+)$/gm)].map((m) => norm(m[1])));
    expect(faqQs.size).toBeGreaterThan(100);
    for (const q of questions) expect(faqQs.has(norm(q.question))).toBe(false);
  });
});

// One test per eval question. They are always created; they run when RAG_URL is set and show as skipped otherwise.
const live = !!process.env.RAG_URL;
describe.skipIf(!live)('live RAG eval (set RAG_URL to run)', () => {
  it.each(questions.map((q) => [q.id + ' ' + q.question, q]))(
    '%s',
    async (_name, q) => {
      const { ask } = await import('../adapters/http.mjs');
      const result = await ask(q.question);
      const s = scoreAnswer(q, result, { requireSources: process.env.RAG_REQUIRE_SOURCES === '1' });
      expect(s, JSON.stringify({ missing: s.missing, missingDocs: s.missingDocs, tooLong: s.tooLong })).toMatchObject({ pass: true });
    },
    30000,
  );
});
```

## `package.json`

Scripts and the Vitest dependency.

```json
{
  "name": "rag-eval",
  "private": true,
  "type": "module",
  "scripts": {
    "eval": "node run.mjs",
    "eval:selftest": "node run.mjs --adapter ./adapters/oracle.mjs --min 1",
    "test": "vitest run tests"
  },
  "devDependencies": {
    "vitest": "^1.6.1"
  }
}
```

