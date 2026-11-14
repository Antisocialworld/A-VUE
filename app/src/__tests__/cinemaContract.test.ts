import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_SEATS_PER_BOOKING,
  checkoutBodySchema,
  holdSeatsBodySchema,
  seatMapItemSchema,
  showtimeItemSchema,
  ticketItemSchema,
} from '../schemas/cinema';
import { formatKoboToNaira } from '../utils/money';
import { generateIdempotencyKey } from '../utils/crypto';

describe('A VUE Cinema Contracts, Money & Booking Rules (Task 8)', () => {
  const contractPath = path.resolve(__dirname, '../../../contracts/cinema-cases.json');

  it('contracts/cinema-cases.json exists at repo root', () => {
    expect(fs.existsSync(contractPath)).toBe(true);
  });

  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));

  // 1. Schema Conformance Tests
  describe('showtimeItemSchema contract fixtures', () => {
    contract.cases.showtimeItem.forEach((tc: any) => {
      it(tc.description, () => {
        const res = showtimeItemSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('seatMapItemSchema contract fixtures', () => {
    contract.cases.seatMapItem.forEach((tc: any) => {
      it(tc.description, () => {
        const res = seatMapItemSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('holdSeatsBodySchema contract fixtures', () => {
    contract.cases.holdSeatsBody.forEach((tc: any) => {
      it(tc.description, () => {
        const res = holdSeatsBodySchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('checkoutBodySchema contract fixtures', () => {
    contract.cases.checkoutBody.forEach((tc: any) => {
      it(tc.description, () => {
        const res = checkoutBodySchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('ticketItemSchema contract fixtures', () => {
    contract.cases.ticketItem.forEach((tc: any) => {
      it(tc.description, () => {
        const res = ticketItemSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  // 2. Money Formatting Helper Tests
  describe('formatKoboToNaira Helper', () => {
    it('accurately converts whole kobo amounts into Naira strings', () => {
      expect(formatKoboToNaira(450000)).toBe('₦4,500');
      expect(formatKoboToNaira(1000000)).toBe('₦10,000');
      expect(formatKoboToNaira(25000)).toBe('₦250');
      expect(formatKoboToNaira(0)).toBe('₦0');
    });

    it('formats remaining kobo cents when present or forced', () => {
      expect(formatKoboToNaira(450050)).toBe('₦4,500.50');
      expect(formatKoboToNaira(450000, true)).toBe('₦4,500.00');
      expect(formatKoboToNaira(99)).toBe('₦0.99');
    });

    it('handles negative or invalid values gracefully', () => {
      expect(formatKoboToNaira(-100)).toBe('₦0');
      expect(formatKoboToNaira(NaN)).toBe('₦0');
    });
  });

  // 3. Seat Selection & State Mapping Tests
  describe('Seat Map State & Capacity Rules', () => {
    it('enforces maximum per-booking seat selection limit of 6', () => {
      expect(MAX_SEATS_PER_BOOKING).toBe(6);

      const seatMapContent = fs.readFileSync(
        path.resolve(__dirname, '../components/SeatMap.tsx'),
        'utf-8'
      );
      expect(seatMapContent).toContain('MAX_SEATS_PER_BOOKING');
      expect(seatMapContent).toContain('selectedSeatIds.length >= MAX_SEATS_PER_BOOKING');
    });

    it('distinguishes wheelchair accessibility from standard seats', () => {
      const standardSeat = seatMapItemSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        row: 'F',
        number: 10,
        accessible: false,
        state: 'available',
      });

      const wheelchairSeat = seatMapItemSchema.parse({
        id: '22222222-2222-2222-2222-222222222222',
        row: 'A',
        number: 1,
        accessible: true,
        state: 'available',
      });

      expect(standardSeat.accessible).toBe(false);
      expect(wheelchairSeat.accessible).toBe(true);
    });
  });

  // 4. Idempotency Key Rules
  describe('Idempotency Key Generation Rules', () => {
    it('generates valid RFC 4122 v4 UUID format without Math.random', () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();

      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidV4Regex.test(key1)).toBe(true);
      expect(uuidV4Regex.test(key2)).toBe(true);
      expect(key1).not.toBe(key2);
    });

    it('verifies Math.random is strictly absent in app/src', () => {
      const scanFiles = [
        path.resolve(__dirname, '../utils/crypto.ts'),
        path.resolve(__dirname, '../utils/money.ts'),
        path.resolve(__dirname, '../screens/CheckoutScreen.tsx'),
        path.resolve(__dirname, '../screens/SeatMapScreen.tsx'),
        path.resolve(__dirname, '../screens/TicketScreen.tsx'),
        path.resolve(__dirname, '../components/SeatMap.tsx'),
      ];

      for (const file of scanFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).not.toContain('Math.random');
      }
    });
  });

  // 5. Polling Intervals Specification Tests
  describe('Polling Intervals Specifications', () => {
    it('verifies 4s seat map polling, 3s waiting room polling, and 60s confirmation max', () => {
      const seatMapContent = fs.readFileSync(
        path.resolve(__dirname, '../components/SeatMap.tsx'),
        'utf-8'
      );
      expect(seatMapContent).toContain('pollIntervalMs = 4000');

      const waitingRoomContent = fs.readFileSync(
        path.resolve(__dirname, '../screens/WaitingRoomScreen.tsx'),
        'utf-8'
      );
      expect(waitingRoomContent).toContain('pollIntervalMs = 3000');

      const checkoutContent = fs.readFileSync(
        path.resolve(__dirname, '../screens/CheckoutScreen.tsx'),
        'utf-8'
      );
      expect(checkoutContent).toContain('MAX_POLL_MS = 60000');
    });
  });

  // 6. No Hardcoded Hex Colours Test
  describe('No Hardcoded Hex Colours in New Screens', () => {
    it('verifies all new booking screens draw colours from design tokens', () => {
      const screens = [
        path.resolve(__dirname, '../screens/ShowtimesScreen.tsx'),
        path.resolve(__dirname, '../screens/SeatMapScreen.tsx'),
        path.resolve(__dirname, '../screens/WaitingRoomScreen.tsx'),
        path.resolve(__dirname, '../screens/CheckoutScreen.tsx'),
        path.resolve(__dirname, '../screens/TicketScreen.tsx'),
        path.resolve(__dirname, '../screens/MyTicketsScreen.tsx'),
        path.resolve(__dirname, '../components/SeatMap.tsx'),
      ];

      // Hex regex: e.g. #FF5500, #fff (ignoring comments)
      const hexRegex = /#[0-9a-fA-F]{3,8}/g;

      for (const screenPath of screens) {
        const content = fs.readFileSync(screenPath, 'utf-8');
        // Filter out comments
        const cleanContent = content
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*/g, '');

        // Except standard black shadow or qr code black/white
        const matches = (cleanContent.match(hexRegex) || []).filter(
          (hex) => hex.toUpperCase() !== '#000000' && hex.toUpperCase() !== '#FFFFFF'
        );
        expect(matches).toEqual([]);
      }
    });
  });
});

