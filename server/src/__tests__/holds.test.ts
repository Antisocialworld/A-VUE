import { describe, expect, it } from 'vitest';
import { holdSeats } from '../lib/holds.js';

describe('Seat Holds Unit Suite (No live Redis needed)', () => {
  it('rejects empty seat list before attempting Redis operations', async () => {
    await expect(
      holdSeats('showtime-1', [], 'user-alice')
    ).rejects.toThrow('INVALID_SEAT_COUNT');
  });

  it('rejects requests exceeding MAX_SEATS_PER_HOLD limit before attempting Redis operations', async () => {
    // Limit is 6 seats
    const sevenSeats = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    await expect(
      holdSeats('showtime-1', sevenSeats, 'user-alice')
    ).rejects.toThrow('INVALID_SEAT_COUNT');
  });
});
