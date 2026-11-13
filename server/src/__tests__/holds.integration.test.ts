/**
 * Seat Holds Integration Tests
 * Note: This integration test suite requires the Docker Redis service running (redis://localhost:6379).
 * Run via: npm run test:integration
 */

import { describe, expect, it } from 'vitest';
import { holdSeats, releaseSeats } from '../lib/holds.js';

describe('Seat Holds Integration Suite (Requires Docker Redis)', () => {
  const testShowtimeId = 'integration-showtime-1';

  it('two users trying to hold the same seat: exactly one wins', async () => {
    const seatId = `test-seat-${Date.now()}`;

    // User A attempts hold
    const resA = await holdSeats(testShowtimeId, [seatId], 'user-alice');
    expect(resA.status).toBe('acquired');
    expect(resA.heldCount).toBe(1);

    // User B attempts same seat
    const resB = await holdSeats(testShowtimeId, [seatId], 'user-bob');
    expect(resB.status).toBe('conflict_held');
    expect(resB.heldCount).toBe(0);

    // Cleanup
    await releaseSeats(testShowtimeId, [seatId], 'user-alice');
  });

  it('enforces all-or-nothing hold: if one seat is held, none are acquired', async () => {
    const seat1 = `seat-all-1-${Date.now()}`;
    const seat2 = `seat-all-2-${Date.now()}`;

    // Alice holds seat 1
    await holdSeats(testShowtimeId, [seat1], 'user-alice');

    // Bob tries to hold seat 1 and seat 2 together
    const bobRes = await holdSeats(testShowtimeId, [seat1, seat2], 'user-bob');
    expect(bobRes.status).toBe('conflict_held');
    expect(bobRes.heldCount).toBe(0);

    // Verify seat 2 was NOT acquired by Bob
    const charlieRes = await holdSeats(testShowtimeId, [seat2], 'user-charlie');
    expect(charlieRes.status).toBe('acquired');

    // Cleanup
    await releaseSeats(testShowtimeId, [seat1], 'user-alice');
    await releaseSeats(testShowtimeId, [seat2], 'user-charlie');
  });

  it('owner-only release: another user cannot release someone else hold', async () => {
    const seatId = `seat-owner-${Date.now()}`;

    // Alice holds seat
    await holdSeats(testShowtimeId, [seatId], 'user-alice');

    // Bob tries to release Alice's hold
    const bobReleased = await releaseSeats(testShowtimeId, [seatId], 'user-bob');
    expect(bobReleased).toBe(0);

    // Alice releases her hold
    const aliceReleased = await releaseSeats(testShowtimeId, [seatId], 'user-alice');
    expect(aliceReleased).toBe(1);
  });
});

