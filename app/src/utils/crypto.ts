/**
 * A VUE Cryptographic Utilities
 * Rule 05: Insecure pseudo-random sources are banned across the application.
 * Cryptographic randomness only.
 */

/**
 * Generates an RFC 4122 v4 UUID using crypto.randomUUID or crypto.getRandomValues.
 * Insecure pseudo-random sources are never used. Cryptographic randomness only.
 */
export function generateIdempotencyKey(): string {
  // 1. Standard Web Crypto API (supported in React Native 0.88 / Hermes)
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // 2. Fallback to crypto.getRandomValues if randomUUID is missing
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    // Set version 4 (0100) and variant (10xx)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // 3. Fallback to expo-crypto if available
  try {
    const ExpoCrypto = require('expo-crypto');
    if (typeof ExpoCrypto.randomUUID === 'function') {
      return ExpoCrypto.randomUUID();
    }
  } catch {
    // expo-crypto not installed
  }

  throw new Error('Cryptographically secure random source is unavailable');
}

