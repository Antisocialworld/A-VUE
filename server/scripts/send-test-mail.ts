/**
 * A VUE — SMTP Mail Smoke Test Script
 * Rule 02 / Task 2:
 * Sends one fixed test message through the same mailer module to the env's SMTP host.
 * Recipient comes from MAIL_TEST_TO (env). If missing, refuses to send and exits non-zero.
 * Prints ONLY "sent" on success, or the error class and code on failure.
 * Never prints verification codes, credentials, recipients, or message body.
 */

import { env } from '../src/env.js';
import { sendSmokeTestEmail } from '../src/lib/mailer.js';

async function main(): Promise<void> {
  const recipient = env.MAIL_TEST_TO?.trim();

  if (!recipient) {
    process.stderr.write('Missing MAIL_TEST_TO environment variable. Refusing to send smoke test email.\n');
    process.exit(1);
  }

  const result = await sendSmokeTestEmail(recipient);

  if (result.success) {
    process.stdout.write('sent\n');
    process.exit(0);
  } else {
    // sendMailSafely has already logged: [Mailer Error] <errorClass>: <errorCode>
    process.exit(1);
  }
}

main().catch((err: any) => {
  const errorClass = err?.name || 'Error';
  const errorCode = err?.code || 'UNKNOWN';
  process.stderr.write(`[Mailer Error] ${errorClass}: ${errorCode}\n`);
  process.exit(1);
});
