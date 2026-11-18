/**
 * A VUE Web Session Storage Adapter
 * Uses localStorage so a web session survives tab closes, with a stored
 * 30-day absolute expiry set at sign-in. All access is wrapped in try/catch.
 */

import { STRINGS } from '../constants/strings';
import { SESSION_TOKEN_KEY } from './sessionTokenKey';

export const SESSION_TOKEN_EXPIRY_KEY = `${SESSION_TOKEN_KEY}_expires_at`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type WebLocalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getWebLocalStorage(): WebLocalStorage {
  try {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
      throw new Error('localStorage unavailable');
    }
    return globalThis.localStorage;
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function setWebSessionToken(token: string): Promise<void> {
  try {
    const storage = getWebLocalStorage();
    storage.setItem(SESSION_TOKEN_KEY, token);
    storage.setItem(SESSION_TOKEN_EXPIRY_KEY, String(Date.now() + THIRTY_DAYS_MS));
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function getWebSessionToken(): Promise<string | null> {
  try {
    const storage = getWebLocalStorage();
    const token = storage.getItem(SESSION_TOKEN_KEY);
    if (token === null) {
      return null;
    }

    const rawExpiry = storage.getItem(SESSION_TOKEN_EXPIRY_KEY);
    const expiry = rawExpiry === null ? Number.NaN : Number(rawExpiry);
    if (!Number.isFinite(expiry) || Date.now() >= expiry) {
      try {
        storage.removeItem(SESSION_TOKEN_KEY);
        storage.removeItem(SESSION_TOKEN_EXPIRY_KEY);
      } catch {
        // Expired data is never returned even if clearing fails.
      }
      return null;
    }

    return token;
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function removeWebSessionToken(): Promise<void> {
  try {
    const storage = getWebLocalStorage();
    storage.removeItem(SESSION_TOKEN_KEY);
    storage.removeItem(SESSION_TOKEN_EXPIRY_KEY);
  } catch {
    throw new Error(STRINGS.common.error);
  }
}
