import crypto from 'node:crypto';
import { query } from './db.js';
import { hashArgon2id, verifyArgon2id } from './argon2.js';
import { env } from '../env.js';
import { sendVerificationCodeEmail, sendPasswordResetEmail } from './mailer.js';
import { consumeEmailSendSlot } from './sendCap.js';

export function generateCrypto6DigitCode(): string {
  // Math.random banned by lint (Rule 02). crypto.randomBytes only.
  const randomUint = crypto.randomBytes(4).readUInt32BE(0);
  const codeInt = (randomUint % 900000) + 100000;
  return codeInt.toString();
}

/**
 * Creates and dispatches a 6-digit code via email.
 * Task 2: Uses shared consumeEmailSendSlot keyed by email.
 * Enforces:
 * - 60s resend cooldown
 * - 5 sends per day per email
 * - 5 min TTL
 * - Argon2id hashing
 */
export async function dispatchAuthCode(
  email: string,
  purpose: 'signup' | 'reset',
  skipSlotCheck: boolean = false,
): Promise<{ cooldownSeconds: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date();

  // 1. Consume shared send cap slot if not already checked by caller
  if (!skipSlotCheck) {
    const slot = await consumeEmailSendSlot(normalizedEmail);
    if (!slot.allowed) {
      if (slot.reason === 'cooldown') {
        throw new Error(
          `Resend code cooldown active. Please wait ${slot.cooldownSeconds} second(s).`,
        );
      }
      if (slot.reason === 'daily_cap') {
        throw new Error('Daily code send cap reached (5 sends per day).');
      }
      // If Redis is unreachable: send no mail and return normal success response without throwing 500 (Task 2)
      return { cooldownSeconds: env.CODE_RESEND_COOLDOWN_SECONDS };
    }
  }

  // 2. Generate 6-digit code and Argon2id hash
  const rawCode = generateCrypto6DigitCode();
  const codeHash = await hashArgon2id(rawCode);
  const expiresAt = new Date(now.getTime() + env.CODE_TTL_SECONDS * 1000);

  // 3. Clear older codes for this email and insert fresh one
  await query('DELETE FROM auth_codes WHERE email = $1;', [normalizedEmail]);

  await query(
    `INSERT INTO auth_codes (email, code_hash, attempts, daily_send_count, last_sent_at, expires_at)
     VALUES ($1, $2, 0, 1, NOW(), $3);`,
    [normalizedEmail, codeHash, expiresAt.toISOString()],
  );

  // 4. Send email over SMTP (Mailpit locally, Brevo in production)
  if (purpose === 'signup') {
    await sendVerificationCodeEmail(normalizedEmail, rawCode);
  } else {
    await sendPasswordResetEmail(normalizedEmail, rawCode);
  }

  return { cooldownSeconds: env.CODE_RESEND_COOLDOWN_SECONDS };
}

/**
 * Validates a 6-digit code.
 * Enforces:
 * - 5 wrong attempts kills code
 * - Expiry check
 * - Deletion on successful verification
 */
export async function verifyAuthCode(email: string, inputCode: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  const result = await query<{
    id: string;
    code_hash: string;
    attempts: number;
    expires_at: Date;
  }>(
    `SELECT id, code_hash, attempts, expires_at
     FROM auth_codes
     WHERE email = $1
     ORDER BY created_at DESC
     LIMIT 1;`,
    [normalizedEmail],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Verification code expired or not found. Please request a new code.');
  }

  // Check expiry
  if (new Date() > new Date(row.expires_at)) {
    await query('DELETE FROM auth_codes WHERE id = $1;', [row.id]);
    throw new Error('Verification code expired. Please request a new code.');
  }

  // Check attempts
  if (row.attempts >= env.MAX_CODE_ATTEMPTS) {
    await query('DELETE FROM auth_codes WHERE id = $1;', [row.id]);
    throw new Error('Maximum attempts reached. This code is invalid. Please request a new code.');
  }

  // Verify Argon2id hash
  const isValid = await verifyArgon2id(row.code_hash, inputCode.trim());

  if (!isValid) {
    const updatedAttempts = row.attempts + 1;
    if (updatedAttempts >= env.MAX_CODE_ATTEMPTS) {
      await query('DELETE FROM auth_codes WHERE id = $1;', [row.id]);
      throw new Error('Maximum attempts reached. This code is invalid. Please request a new code.');
    } else {
      await query('UPDATE auth_codes SET attempts = $1 WHERE id = $2;', [
        updatedAttempts,
        row.id,
      ]);
      const remaining = env.MAX_CODE_ATTEMPTS - updatedAttempts;
      throw new Error(`Incorrect code. ${remaining} attempt(s) remaining.`);
    }
  }

  // Successful verification: delete code so it cannot be reused (Rule 02)
  await query('DELETE FROM auth_codes WHERE id = $1;', [row.id]);
  return true;
}

