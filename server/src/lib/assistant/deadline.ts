// One overall request budget: below the app's 27 s AbortController timeout, leaving
// headroom for response transit even if a helper misses its own signal.
export const ASSISTANT_REQUEST_DEADLINE_MS = 24000;

/** Below this, starting a model attempt cannot finish usefully inside the request budget. */
export const MIN_MODEL_BUDGET_MS = 3000;
