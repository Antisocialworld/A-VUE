/**
 * A VUE Money Formatter Utility
 * Rule 06: Money is strictly integer kobo.
 * Client NEVER computes charges: displays only server-returned amounts.
 */

/**
 * Formats integer kobo amount into user-facing Naira string (e.g. 450000 -> "₦4,500").
 * Avoids floating point issues through integer division and remainder.
 */
export function formatKoboToNaira(amountKobo: number, forceDecimals = false): string {
  if (isNaN(amountKobo) || amountKobo < 0) {
    return '₦0';
  }

  const wholeNaira = Math.floor(amountKobo / 100);
  const remainingKobo = amountKobo % 100;

  // Format whole portion with thousands separators
  const formattedWhole = wholeNaira.toLocaleString('en-US');

  if (forceDecimals || remainingKobo > 0) {
    const formattedKobo = remainingKobo.toString().padStart(2, '0');
    return `₦${formattedWhole}.${formattedKobo}`;
  }

  return `₦${formattedWhole}`;
}

