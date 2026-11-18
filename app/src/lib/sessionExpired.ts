/**
 * A VUE shared session-expiry handling for authenticated API calls.
 *
 * One place clears the stored session and notifies the app, so every client
 * reuses the same flow instead of duplicating 401 handling.
 */

import { deleteSessionToken } from './secureStore';

type SessionExpiredListener = () => void;

const listeners: SessionExpiredListener[] = [];

/** Subscribe to the app's session-expired flow. Returns an unsubscribe function. */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
}

function notifySessionExpired(): void {
  // Copy so a listener that unsubscribes during notification cannot skip the next one.
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Handles a 401 from an authenticated call.
 * Clears the stored session once and triggers the app's existing session-expired
 * flow. Non-401 statuses are ignored so public calls and ordinary errors are
 * untouched.
 */
export async function handleUnauthorized(status: number): Promise<boolean> {
  if (status !== 401) {
    return false;
  }
  await deleteSessionToken();
  notifySessionExpired();
  return true;
}
