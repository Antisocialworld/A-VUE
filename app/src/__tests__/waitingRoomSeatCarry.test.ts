import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Waiting Room Seat Carry Contract (Task A)', () => {
  const seatMapScreenPath = path.resolve(__dirname, '../screens/SeatMapScreen.tsx');
  const appPath = path.resolve(__dirname, '../../App.tsx');

  const seatMapScreenSrc = fs.readFileSync(seatMapScreenPath, 'utf-8');
  const appSrc = fs.readFileSync(appPath, 'utf-8');

  it('SeatMapScreen carries both selectedSeatIds and selectedSeats into onOpenWaitingRoom', () => {
    // Prop signature includes optional/required seat items
    expect(seatMapScreenSrc).toContain('onOpenWaitingRoom: (seatIds: string[], seats?: SeatMapItem[]) => void');
    // Invocation passes both selectedSeatIds and selectedSeats
    expect(seatMapScreenSrc).toContain('onOpenWaitingRoom(selectedSeatIds, selectedSeats)');
  });

  it('App.tsx maintains refs for selectedSeatIds and selectedSeats to prevent closure staleness', () => {
    expect(appSrc).toContain('const selectedSeatIdsRef = useRef<string[]>([])');
    expect(appSrc).toContain('const selectedSeatsRef = useRef<SeatMapItem[]>([])');
  });

  it('App.tsx updates both state and refs in onOpenWaitingRoom and onProceedToCheckout', () => {
    // onProceedToCheckout syncs refs
    expect(appSrc).toContain('selectedSeatIdsRef.current = params.selectedSeatIds');
    expect(appSrc).toContain('selectedSeatsRef.current = params.selectedSeats');

    // onOpenWaitingRoom syncs refs and state
    expect(appSrc).toContain('onOpenWaitingRoom={(seatIds, seats) =>');
    expect(appSrc).toContain('selectedSeatIdsRef.current = seatIds');
    expect(appSrc).toContain('selectedSeatsRef.current = seats');
  });

  it('App.tsx onAdmitted holds seats via ref and guarantees selectedSeats is passed to CheckoutScreen', () => {
    // onAdmitted resolves seatIds from ref
    expect(appSrc).toContain('selectedSeatIdsRef.current.length > 0');
    expect(appSrc).toContain('cinemaClient.holdSeats(selectedShowtime.id, seatIdsToHold, pass)');
    expect(appSrc).toContain('setSelectedSeats(selectedSeatsRef.current)');

    // CheckoutScreen receives activeSeats from ref/state
    expect(appSrc).toContain('const activeSeats = selectedSeatsRef.current.length > 0 ? selectedSeatsRef.current : selectedSeats');
    expect(appSrc).toContain('selectedSeats={activeSeats}');
  });

  it('SeatMapScreen opens waiting room strictly on WAITING_ROOM_REQUIRED and toasts on RATE_LIMIT_EXCEEDED', () => {
    expect(seatMapScreenSrc).toContain("if (err.code === 'WAITING_ROOM_REQUIRED')");
    expect(seatMapScreenSrc).not.toContain("err.status === 429");
    expect(seatMapScreenSrc).toContain("else if (err.code === 'RATE_LIMIT_EXCEEDED')");
    expect(seatMapScreenSrc).toContain("setToastMessage(STRINGS.seatMap.rateLimitToast)");
  });
});
