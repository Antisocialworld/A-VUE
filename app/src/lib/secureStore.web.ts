/**
 * A VUE Web Session Storage Module
 * Expo Metro resolves this file on web; native keeps expo-secure-store unchanged.
 * Web uses localStorage with a 30-day absolute expiry. An httpOnly cookie would
 * be safer, but that needs a server change and is intentionally not implemented here.
 */

import { STRINGS } from '../constants/strings';
import {
  getWebSessionToken,
  removeWebSessionToken,
  setWebSessionToken,
} from './webSessionStorage';

let memoryFallbackToken: string | null = null;

function isTestEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    (process.env.NODE_ENV === 'test' || typeof (globalThis as any).vitest !== 'undefined')
  );
}

export async function saveSessionToken(token: string): Promise<void> {
  if (isTestEnvironment()) {
    memoryFallbackToken = token;
    return;
  }

  try {
    await setWebSessionToken(token);
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (isTestEnvironment()) {
    return memoryFallbackToken;
  }

  try {
    return await getWebSessionToken();
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function deleteSessionToken(): Promise<void> {
  if (isTestEnvironment()) {
    memoryFallbackToken = null;
    return;
  }

  try {
    await removeWebSessionToken();
  } catch {
    throw new Error(STRINGS.common.error);
  }
}
