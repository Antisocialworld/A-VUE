import { z } from 'zod';

// ==============================================================================
// Showtimes Schemas
// ==============================================================================
export const movieShowtimesQuerySchema = z.object({
  movieId: z.string().min(1, 'movieId is required'),
});

export const showtimeItemSchema = z.object({
  id: z.string().uuid(),
  movieId: z.string(),
  cinemaId: z.string().uuid(),
  cinemaName: z.string(),
  city: z.string(),
  hallId: z.string().uuid(),
  hallName: z.string(),
  startsAt: z.string(),
  priceKobo: z.number().int().nonnegative(),
  isCancelled: z.boolean(),
});

export type ShowtimeItem = z.infer<typeof showtimeItemSchema>;

export const movieShowtimesResponseSchema = z.object({
  movieId: z.string(),
  showtimes: z.array(showtimeItemSchema),
});

export type MovieShowtimesResponse = z.infer<typeof movieShowtimesResponseSchema>;

// ==============================================================================
// On-Demand Showtimes Ensure Schemas
// ==============================================================================
export const ensureMovieShowtimesReasonSchema = z.enum([
  'NOT_ELIGIBLE',
  'TMDB_UNAVAILABLE',
  'NO_CAPACITY',
  'CAP_REACHED',
]);

export type EnsureMovieShowtimesReason = z.infer<typeof ensureMovieShowtimesReasonSchema>;

export const ensureMovieShowtimesResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  reason: ensureMovieShowtimesReasonSchema.optional(),
});

export type EnsureMovieShowtimesResponse = z.infer<typeof ensureMovieShowtimesResponseSchema>;

// ==============================================================================
// Seat Map Schemas
// ==============================================================================
export const seatStateEnum = z.enum(['available', 'held', 'sold']);
export type SeatState = z.infer<typeof seatStateEnum>;

export const seatMapItemSchema = z.object({
  id: z.string().uuid(),
  row: z.string(),
  number: z.number().int().positive(),
  accessible: z.boolean(),
  state: seatStateEnum,
});

export type SeatMapItem = z.infer<typeof seatMapItemSchema>;

export const seatMapResponseSchema = z.object({
  showtimeId: z.string().uuid(),
  hallId: z.string().uuid(),
  totalSeats: z.number().int().positive(),
  seats: z.array(seatMapItemSchema),
  cachedAt: z.string().optional(),
});

export type SeatMapResponse = z.infer<typeof seatMapResponseSchema>;

// ==============================================================================
// Seat Holds Schemas
// ==============================================================================
export const MAX_SEATS_PER_BOOKING = 6; // Sourced from server MAX_SEATS_PER_HOLD (Hold: max 6 seats)

export const holdSeatsBodySchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(MAX_SEATS_PER_BOOKING),
  waitingRoomPass: z.string().optional(),
});

export type HoldSeatsBody = z.infer<typeof holdSeatsBodySchema>;

export const holdSeatsResponseSchema = z.object({
  success: z.boolean(),
  showtimeId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()),
  expiresAt: z.string(),
  holdTtlSeconds: z.number().int().positive(),
});

export type HoldSeatsResponse = z.infer<typeof holdSeatsResponseSchema>;

export const releaseHoldsBodySchema = z.object({
  seatIds: z.array(z.string().uuid()).optional(),
});

export type ReleaseHoldsBody = z.infer<typeof releaseHoldsBodySchema>;

// ==============================================================================
// Waiting Room Schemas
// ==============================================================================
export const waitingRoomStatusSchema = z.object({
  status: z.enum(['admitted', 'queued']),
  pass: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
  estimatedWaitSeconds: z.number().int().nonnegative().optional(),
});

export type WaitingRoomStatus = z.infer<typeof waitingRoomStatusSchema>;

// ==============================================================================
// Checkout Schemas
// ==============================================================================
export const checkoutBodySchema = z.object({
  showtimeId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()).min(1).max(6),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export const checkoutResponseSchema = z.object({
  paymentId: z.string().uuid(),
  txRef: z.string(),
  amountKobo: z.number().int().positive(),
  feeKobo: z.number().int().nonnegative(),
  currency: z.literal('NGN'),
  paymentLink: z.string().url(),
  isSimulated: z.boolean(),
  testMode: z.boolean().optional(),
});

export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const checkoutConfigResponseSchema = z.object({
  testMode: z.boolean(),
});

export type CheckoutConfigResponse = z.infer<typeof checkoutConfigResponseSchema>;

// ==============================================================================
// Tickets Schemas
// ==============================================================================
export const ticketItemSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  showtimeId: z.string().uuid(),
  movieTitle: z.string().optional(),
  cinemaName: z.string(),
  hallName: z.string(),
  row: z.string(),
  number: z.number().int().positive(),
  startsAt: z.string(),
  status: z.enum(['active', 'used', 'cancelled']),
  createdAt: z.string(),
  usedAt: z.string().optional(),
});

export type TicketItem = z.infer<typeof ticketItemSchema>;

export const userTicketsResponseSchema = z.object({
  tickets: z.array(ticketItemSchema),
});

export type UserTicketsResponse = z.infer<typeof userTicketsResponseSchema>;

export const generateQrResponseSchema = z.object({
  ticketId: z.string().uuid(),
  qrReference: z.string(),
});

export type GenerateQrResponse = z.infer<typeof generateQrResponseSchema>;

export const verifyTicketBodySchema = z.object({
  reference: z.string().min(1, 'reference is required'),
});

export const verifyTicketResponseSchema = z.object({
  valid: z.boolean(),
  status: z.string(),
  ticketId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  usedAt: z.string().optional(),
  message: z.string(),
});

export type VerifyTicketResponse = z.infer<typeof verifyTicketResponseSchema>;

