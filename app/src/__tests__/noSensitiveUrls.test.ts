import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cinemaClientSrc = fs.readFileSync(
  path.resolve(__dirname, '../api/cinemaClient.ts'),
  'utf-8',
);
const authClientSrc = fs.readFileSync(
  path.resolve(__dirname, '../api/authClient.ts'),
  'utf-8',
);

describe('A VUE web paths keep sensitive values out of URLs', () => {
  it('sends the ticket id in the QR request body, never in the URL', () => {
    expect(cinemaClientSrc).toContain("'/tickets/qr'");
    expect(cinemaClientSrc).toContain('body: JSON.stringify({ ticketId })');
    expect(cinemaClientSrc).not.toContain('/tickets/${ticketId}/qr');
  });

  it('keeps the session token in the Authorization header', () => {
    expect(authClientSrc).toContain("headers['Authorization'] = `Bearer ${token}`");
    expect(authClientSrc).not.toContain('?token=');
    expect(authClientSrc).not.toContain('#token=');
  });

  it('uses fixed auth paths with email and code in the JSON body', () => {
    expect(authClientSrc).toContain("'/auth/signup'");
    expect(authClientSrc).toContain("'/auth/verify-code'");
    expect(authClientSrc).toContain("'/auth/reset-confirm'");
    expect(authClientSrc).not.toMatch(/auth\/[^'"`?]*\?[^'"`]*(email|code)/i);
  });
});
