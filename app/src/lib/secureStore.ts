/**
 * A VUE Secure Storage Module
 * Rule 02: Platform secure storage for session secrets (expo-secure-store).
 * Never logged, never AsyncStorage.
 * In-memory fallback applies ONLY in unit test environments.
 * In production/dev runtime, a failed read or write throws a generic error string.
 */

import { STRINGS } from '../constants/strings';

const SESSION_TOKEN_KEY = 'avue_session_token';

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

  // Runtime environment: fail explicitly, never silently fall back
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (isTestEnvironment()) {
    return memoryFallbackToken;
  }

  // Runtime environment: fail explicitly, never silently fall back
  try {
    const SecureStore = await import('expo-secure-store');
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    throw new Error(STRINGS.common.error);
  }
}

export async function deleteSessionToken(): Promise<void> {
  if (isTestEnvironment()) {
    memoryFallbackToken = null;
    return;
  }

  // Runtime environment: fail explicitly, never silently fall back
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    throw new Error(STRINGS.common.error);
  }
}
