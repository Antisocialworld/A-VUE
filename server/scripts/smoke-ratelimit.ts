/**
 * A VUE — Rate Limit Proof Smoke Script
 * Rule 02 / Task 5:
 * Sends RATE_LIMIT_AUTH_IP + 1 POST /auth/signin requests with a throwaway body.
 * Prints ONLY status codes, the position of the first 429, and the Retry-After header.
 * Never prints bodies or credentials.
 */

import { env } from '../src/env.js';

async function main(): Promise<void> {
  const host = env.HOST === '0.0.0.0' ? '127.0.0.1' : env.HOST;
  const targetUrl = `http://${host}:${env.PORT}/auth/signin`;

  const totalRequests = env.RATE_LIMIT_AUTH_IP + 1;
  const statusCodes: number[] = [];
  let first429Position: number | null = null;
  let retryAfterHeader: string | null = null;

  for (let i = 1; i <= totalRequests; i++) {
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'rate-limit-smoke@example.com',
          password: 'ThrowawayPassword123!',
        }),
      });

      statusCodes.push(res.status);

      if (res.status === 429 && first429Position === null) {
        first429Position = i;
        retryAfterHeader = res.headers.get('retry-after');
      }
    } catch (err: any) {
      process.stderr.write(
        `[RateLimit Smoke Error] Request #${i} connection failure: ${err?.code || 'UNKNOWN'}\n`,
      );
      process.exit(1);
    }
  }

  process.stdout.write(`Status codes: ${statusCodes.join(', ')}\n`);
  if (first429Position !== null) {
    process.stdout.write(`First 429 received at request position: #${first429Position}\n`);
    process.stdout.write(`Retry-After header: ${retryAfterHeader || 'none'}\n`);
  } else {
    process.stdout.write('No 429 received within request quota.\n');
  }
}

main().catch((err: any) => {
  process.stderr.write(`[RateLimit Smoke Error] Fatal: ${err?.name || 'Error'}\n`);
  process.exit(1);
});

