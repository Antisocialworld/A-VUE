import { describe, expect, it } from 'vitest';
import { STRINGS } from '../constants/strings';

describe('Task 8: Seat Deselected Toast Grammar', () => {
  it('singular: "Seat H-1 is no longer available and was deselected."', () => {
    const msg = STRINGS.seatMap.seatsDeselectedToast(['H-1']);
    expect(msg).toBe('Seat H-1 is no longer available and was deselected.');
  });

  it('two seats: "Seats H-1 and H-2 are no longer available and were deselected."', () => {
    const msg = STRINGS.seatMap.seatsDeselectedToast(['H-1', 'H-2']);
    expect(msg).toBe('Seats H-1 and H-2 are no longer available and were deselected.');
  });

  it('five seats: comma-list with final "and", plural verb form', () => {
    const msg = STRINGS.seatMap.seatsDeselectedToast(['H-1', 'H-2', 'H-3', 'H-4', 'H-5']);
    expect(msg).toBe(
      'Seats H-1, H-2, H-3, H-4 and H-5 are no longer available and were deselected.',
    );
  });

  it('old key seatDeselectedToast no longer exists on STRINGS.seatMap', () => {
    expect((STRINGS.seatMap as Record<string, unknown>)['seatDeselectedToast']).toBeUndefined();
  });
});
