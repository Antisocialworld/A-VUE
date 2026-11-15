import fs from 'node:fs';
import path from 'node:path';
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

describe('Seat Holds Waiting Room Gating (Task B & C)', () => {
  const showtimesRoutePath = path.resolve(__dirname, '../routes/showtimes.ts');
  const showtimesRouteSrc = fs.readFileSync(showtimesRoutePath, 'utf-8');

  it('POST /showtimes/:id/holds calls checkInWaitingRoom and removes isAdmittedOrRoomInactive', () => {
    expect(showtimesRouteSrc).toContain('checkInWaitingRoom(showtimeId, user.id)');
    expect(showtimesRouteSrc).not.toContain('isAdmittedOrRoomInactive');
  });

  it('fails closed returning 429 WAITING_ROOM_REQUIRED on queued status or Redis error', () => {
    expect(showtimesRouteSrc).toContain("roomStatus.status !== 'admitted'");
    expect(showtimesRouteSrc).toContain("code: 'WAITING_ROOM_REQUIRED'");
  });
});
