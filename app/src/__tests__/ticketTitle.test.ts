import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../constants/strings';

describe('Ticket movie title rendering contract (Z2)', () => {
  const myTicketsPath = path.resolve(__dirname, '../screens/MyTicketsScreen.tsx');
  const ticketScreenPath = path.resolve(__dirname, '../screens/TicketScreen.tsx');

  const myTicketsSrc = fs.readFileSync(myTicketsPath, 'utf-8');
  const ticketSrc = fs.readFileSync(ticketScreenPath, 'utf-8');

  it('defines ticket title fallbacks in strings with unchanged text', () => {
    expect(STRINGS.tickets.movieTitleFallback).toBe('Movie Ticket');
    expect(STRINGS.tickets.movieTitleAccessibilityFallback).toBe('Movie');
  });

  it('My Tickets card renders title with fallback in heading and accessibility label', () => {
    expect(myTicketsSrc).toContain(
      'accessibilityLabel={`${item.movieTitle || STRINGS.tickets.movieTitleAccessibilityFallback}, ${item.cinemaName}, Row ${item.row} Seat ${item.number}, ${item.status}`}',
    );
    expect(myTicketsSrc).toContain('{item.movieTitle || STRINGS.tickets.movieTitleFallback}');

    // Hardcoded fallback literals removed from screen code
    expect(myTicketsSrc).not.toContain("item.movieTitle || 'Movie Ticket'");
    expect(myTicketsSrc).not.toContain("item.movieTitle || 'Movie',");
  });

  it('Ticket screen renders title with fallback in header', () => {
    expect(ticketSrc).toContain('{ticket.movieTitle || STRINGS.tickets.movieTitleFallback}');
    expect(ticketSrc).not.toContain("ticket.movieTitle || 'Movie Ticket'");
  });
});
