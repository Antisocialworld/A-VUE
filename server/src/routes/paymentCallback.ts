/**
 * A VUE public Flutterwave return page.
 * No database, ticket issuance, query parsing or redirect target from request input.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { checkoutRateLimit } from '../lib/rateLimit.js';

const DEFAULT_APP_RETURN_URL = 'avue://payment-return';

// Server-side page text (no app strings.ts surface in the server build).
const PAYMENT_CALLBACK_STRINGS = {
  title: 'A VUE',
  paymentReceived: 'Payment received',
  returnToApp: 'Return to A VUE',
} as const;

function getAppReturnUrl(): string {
  return env.APP_RETURN_URL || DEFAULT_APP_RETURN_URL;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeInlineScriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildCallbackHtml(): string {
  const returnUrl = getAppReturnUrl();
  const hrefUrl = escapeHtml(returnUrl);
  const scriptUrl = escapeInlineScriptString(returnUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${PAYMENT_CALLBACK_STRINGS.title}</title>
</head>
<body>
  <main>
    <p>${PAYMENT_CALLBACK_STRINGS.paymentReceived}</p>
    <a href="${hrefUrl}">${PAYMENT_CALLBACK_STRINGS.returnToApp}</a>
  </main>
  <script>window.location.replace(${scriptUrl});</script>
</body>
</html>`;
}

export async function paymentCallbackRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/payments/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const allowed = await checkoutRateLimit(request, reply);
      if (!allowed) return undefined;

      return reply
        .status(200)
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(buildCallbackHtml());
    },
  );
}

export { DEFAULT_APP_RETURN_URL };
