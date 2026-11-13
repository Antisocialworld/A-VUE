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

export const movieShowtimesResponseSchema = z.object({
  movieId: z.string(),
  showtimes: z.array(showtimeItemSchema),
});

// ==============================================================================
// Seat Map Schemas
// ==============================================================================
export const seatStateEnum = z.enum(['available', 'held', 'sold']);

export const seatMapItemSchema = z.object({
  id: z.string().uuid(),
  row: z.string(),
  number: z.number().int().positive(),
  accessible: z.boolean(),
  state: seatStateEnum,
});

export const seatMapResponseSchema = z.object({
  showtimeId: z.string().uuid(),
  hallId: z.string().uuid(),
  totalSeats: z.number().int().positive(),
  seats: z.array(seatMapItemSchema),
  cachedAt: z.string().optional(),
});

// ==============================================================================
// Seat Holds Schemas
// ==============================================================================
export const holdSeatsBodySchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(6),
  waitingRoomPass: z.string().optional(),
});

export const holdSeatsResponseSchema = z.object({
  success: z.boolean(),
  showtimeId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()),
  expiresAt: z.string(),
  holdTtlSeconds: z.number().int().positive(),
});

export const releaseHoldsBodySchema = z.object({
  seatIds: z.array(z.string().uuid()).optional(),
});

// ==============================================================================
// Waiting Room Schemas
// ==============================================================================
export const waitingRoomStatusSchema = z.object({
  status: z.enum(['admitted', 'queued']),
  pass: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
  estimatedWaitSeconds: z.number().int().nonnegative().optional(),
});

// ==============================================================================
// Checkout Schemas
// ==============================================================================
export const checkoutBodySchema = z.object({
  showtimeId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()).min(1).max(6),
});

export const checkoutResponseSchema = z.object({
  paymentId: z.string().uuid(),
  txRef: z.string(),
  amountKobo: z.number().int().positive(),
  feeKobo: z.number().int().nonnegative(),
  currency: z.literal('NGN'),
  paymentLink: z.string().url(),
  isSimulated: z.boolean(),
});

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

export const userTicketsResponseSchema = z.object({
  tickets: z.array(ticketItemSchema),
});

export const generateQrResponseSchema = z.object({
  ticketId: z.string().uuid(),
  qrReference: z.string(),
});

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

