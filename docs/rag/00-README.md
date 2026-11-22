# Cinema RAG dataset (fictional)

Everything here is invented: films, people, venues, addresses, phone numbers, prices, scores and policies. A few generic film titles may match real films by coincidence, so check before any public use.

## Files

| File | What it is |
|---|---|
| `rag-chunks.md` | The corpus: 251 chunk cards (24 movies, 3 cinemas, 6 policies, 149 FAQ question-and-answer pairs, weekly showtimes, 20 people). **This is the file to ingest.** |
| `CHUNK-CARD.md` | The chunking rules, the chunk types and an index of every chunk. |
| `rag-evals.md` | 59 test questions with expected answers, must-include facts and supporting chunks, plus the JSON copy. |
| `RAG-EVAL-RUNNER.md` | The runner, the scorer, the HTTP adapter and the Vitest file, each in a code block with its path. |

## Order

1. Ingest `rag-chunks.md` using the rules in `CHUNK-CARD.md`.
2. Create the files from `RAG-EVAL-RUNNER.md`, and save the JSON block of `rag-evals.md` as `tests/eval/questions.json`.
3. Run the self-test, then point `RAG_URL` at your RAG and run again.

## Built-in edge cases

- Two near-identical titles: Harbor Lights (1998) and Harbour Lights (2019).
- Hours that cross midnight, and days a venue is closed. The Marigold Rooftop is closed Monday and Tuesday.
- Negative answers: the Marigold Rooftop shows no family or G-rated films.
- Facts stored in more than one chunk that must agree (accessibility, bar, prices).
- The FAQ pairs are worded differently from the eval questions on purpose, so the evals test retrieval, not text matching.

## Limits

- Chunks are short, so these evals test retrieval accuracy and not long-document chunking.
- The scorer is lenient on wording and strict on facts. An answer that lists everything is failed by a length cap (800 characters).
