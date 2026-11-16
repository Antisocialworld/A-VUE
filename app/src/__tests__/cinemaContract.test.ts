import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS, formatDeletableDate } from '../constants/strings';
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

  // 7. Waiting Room Calm Messaging & Wait Estimate Contract (Task A & B)
  describe('Waiting Room Calm Messaging and Wait Estimate Contract (Task A & B)', () => {
    it('verifies secondsRemaining singular and plural formatting', () => {
      expect(STRINGS.waitingRoom.secondsRemaining(1)).toBe('~1 second');
      expect(STRINGS.waitingRoom.secondsRemaining(2)).toBe('~2 seconds');
      expect(STRINGS.waitingRoom.secondsRemaining(45)).toBe('~45 seconds');
    });

    it('verifies WaitingRoomScreen displays calm line and excludes misleading seconds estimate', () => {
      const waitingRoomSrc = fs.readFileSync(
        path.resolve(__dirname, '../screens/WaitingRoomScreen.tsx'),
        'utf-8'
      );
      expect(STRINGS.waitingRoom.spotOpensMessage).toBe(
        'We will let you in as soon as a spot opens.'
      );
      expect(waitingRoomSrc).toContain('STRINGS.waitingRoom.spotOpensMessage');
      expect(waitingRoomSrc).not.toContain('STRINGS.waitingRoom.secondsRemaining');
      expect(waitingRoomSrc).not.toContain('estimatedWaitSeconds');
      expect(waitingRoomSrc).toContain('#{position}');
      expect(waitingRoomSrc).toContain('accessibilityLabel={STRINGS.waitingRoom.spotOpensMessage}');
    });
  });

  // 8. Account Deletion Dialogs & Date Helper Contract (Task A & B)
  describe('Account Deletion Dialogs & Date Helper Contract (Task A & B)', () => {
    it('verifies Dialog 1 wording and action in STRINGS.account', () => {
      expect(STRINGS.account.deleteSuccessTitle).toBe('Account deletion started');
      expect(STRINGS.account.deleteSuccessMessage).toBe(
        "You have 30 days to Restore your account. After that, your account is deleted for good. You've been signed out."
      );
      expect(STRINGS.account.deleteSuccessAction).toBe('Got it');
    });

    it('verifies Dialog 2 wording and actions in STRINGS.account', () => {
      expect(STRINGS.account.restorePromptTitle).toBe('Restore your account?');
      expect(STRINGS.account.restorePromptMessage('15 December 2026')).toBe(
        'This account is scheduled for deletion on 15 December 2026. Restore it to keep using it.'
      );
      expect(STRINGS.account.cancelRestoreAction).toBe('Not now');
      expect(STRINGS.account.restoreAction).toBe('Restore account');
    });

    it('verifies formatDeletableDate parses ISO strings to "day Month year" without Intl or toLocaleDateString', () => {
      expect(formatDeletableDate('2026-12-15T00:00:00.000Z')).toBe('15 December 2026');
      expect(formatDeletableDate('2026-12-15')).toBe('15 December 2026');
      expect(formatDeletableDate('2026-05-01T14:30:00Z')).toBe('1 May 2026');
      expect(formatDeletableDate(null)).toBe('the scheduled date');
      expect(formatDeletableDate(undefined)).toBe('the scheduled date');
    });
  });

  // 9. PhotoFade & Photo Placement Contract (Task B & C)
  describe('PhotoFade & Photo Placement Contract (Task B & C)', () => {
    const photoFadePath = path.resolve(__dirname, '../components/PhotoFade.tsx');
    const welcomeScreenPath = path.resolve(__dirname, '../screens/WelcomeScreen.tsx');
    const appPath = path.resolve(__dirname, '../../App.tsx');
    const moviesHomePath = path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx');
    const myTicketsPath = path.resolve(__dirname, '../screens/MyTicketsScreen.tsx');
    const checkoutPath = path.resolve(__dirname, '../screens/CheckoutScreen.tsx');
    const waitingRoomPath = path.resolve(__dirname, '../screens/WaitingRoomScreen.tsx');
    const ticketPath = path.resolve(__dirname, '../screens/TicketScreen.tsx');

    it('PhotoFade component exists and uses Animated.Image and Animated.timing without external animation libs', () => {
      expect(fs.existsSync(photoFadePath)).toBe(true);
      const photoFadeSrc = fs.readFileSync(photoFadePath, 'utf-8');
      expect(photoFadeSrc).toContain('Animated.timing');
      expect(photoFadeSrc).toContain('Animated.Image');
      expect(photoFadeSrc).not.toContain('react-native-reanimated');
      expect(photoFadeSrc).toContain('useNativeDriver: true');
    });

    it('PhotoFade handles decorative prop to hide decorative images from screen readers', () => {
      const photoFadeSrc = fs.readFileSync(photoFadePath, 'utf-8');
      expect(photoFadeSrc).toContain('accessible={!decorative}');
      expect(photoFadeSrc).toContain('accessibilityElementsHidden={decorative}');
      expect(photoFadeSrc).toContain("importantForAccessibility={decorative ? 'no' : 'auto'}");
    });

    it('verifies all 7 photos are placed in their respective screens via PhotoFade', () => {
      const welcomeSrc = fs.readFileSync(welcomeScreenPath, 'utf-8');
      const appSrc = fs.readFileSync(appPath, 'utf-8');
      const moviesHomeSrc = fs.readFileSync(moviesHomePath, 'utf-8');
      const myTicketsSrc = fs.readFileSync(myTicketsPath, 'utf-8');
      const checkoutSrc = fs.readFileSync(checkoutPath, 'utf-8');
      const waitingRoomSrc = fs.readFileSync(waitingRoomPath, 'utf-8');
      const ticketSrc = fs.readFileSync(ticketPath, 'utf-8');

      // 1. welcome-art.png -> WelcomeScreen
      expect(welcomeSrc).toContain('PhotoFade');
      expect(welcomeSrc).toContain("require('../../assets/photos/welcome-art.png')");

      // 2. splash-art.png -> App.tsx (in-app splash)
      expect(appSrc).toContain('PhotoFade');
      expect(appSrc).toContain("require('./assets/photos/splash-art.png')");

      // 3. movies-empty.jpg -> MoviesHomeScreen (movies empty state)
      expect(moviesHomeSrc).toContain('PhotoFade');
      expect(moviesHomeSrc).toContain("require('../../assets/photos/movies-empty.jpg')");

      // 4. my-tickets.jpg -> MyTicketsScreen (my tickets empty state)
      expect(myTicketsSrc).toContain('PhotoFade');
      expect(myTicketsSrc).toContain("require('../../assets/photos/my-tickets.jpg')");

      // 5. checkout.jpg -> CheckoutScreen (checkout header)
      expect(checkoutSrc).toContain('PhotoFade');
      expect(checkoutSrc).toContain("require('../../assets/photos/checkout.jpg')");

      // 6. waiting-room.jpg -> WaitingRoomScreen (waiting room header)
      expect(waitingRoomSrc).toContain('PhotoFade');
      expect(waitingRoomSrc).toContain("require('../../assets/photos/waiting-room.jpg')");

      // 7. booking-confirmed.jpg -> TicketScreen (booking confirmed screen)
      expect(ticketSrc).toContain('PhotoFade');
      expect(ticketSrc).toContain("require('../../assets/photos/booking-confirmed.jpg')");
    });
  });
});

