import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ticketsRouteSrc = fs.readFileSync(
  path.resolve(__dirname, '../routes/tickets.ts'),
  'utf-8',
);

describe('Ticket QR request keeps the ticket id out of URLs', () => {
  it('accepts POST /tickets/qr with ticketId from the JSON body', () => {
    expect(ticketsRouteSrc).toContain("fastify.post('/tickets/qr'");
    expect(ticketsRouteSrc).toContain('const body = request.body as { ticketId?: string };');
    expect(ticketsRouteSrc).toContain("message: 'A ticket id is required.'");
  });

  it('no longer accepts a ticket id as a route parameter', () => {
    expect(ticketsRouteSrc).not.toContain("fastify.post('/tickets/:id/qr'");
    expect(ticketsRouteSrc).not.toContain('request.params as { id: string }');
  });
});
