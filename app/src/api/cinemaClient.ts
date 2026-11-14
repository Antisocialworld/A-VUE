import {
  CheckoutBody,
  CheckoutResponse,
  checkoutBodySchema,
  checkoutResponseSchema,
  GenerateQrResponse,
  generateQrResponseSchema,
  HoldSeatsBody,
  HoldSeatsResponse,
  holdSeatsBodySchema,
  holdSeatsResponseSchema,
  MovieShowtimesResponse,
  movieShowtimesResponseSchema,
  ReleaseHoldsBody,
  releaseHoldsBodySchema,
  SeatMapResponse,
  seatMapResponseSchema,
  UserTicketsResponse,
  userTicketsResponseSchema,
  WaitingRoomStatus,
  waitingRoomStatusSchema,
} from '../schemas/cinema';
import { STRINGS } from '../constants/strings';
import { getSessionToken } from '../lib/secureStore';

export class CinemaClient {
  private getBaseUrl(): string {
    const url = process.env.EXPO_PUBLIC_API_URL;
    const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

    if (!url || !url.trim()) {
      if (isDev) {
        throw new Error(
          'EXPO_PUBLIC_API_URL environment variable is missing. Please define EXPO_PUBLIC_API_URL in app/.env',
        );
      }
      throw new Error(STRINGS.common.genericError);
    }
    const trimmed = url.trim();

    // In production (not __DEV__), require https
    if (!isDev && !trimmed.startsWith('https://')) {
      throw new Error(STRINGS.common.genericError);
    }
    return trimmed;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    customHeaders: Record<string, string> = {}
  ): Promise<{ data: T; status: number }> {
    const url = `${this.getBaseUrl()}${path}`;
    const token = await getSessionToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...customHeaders,
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per Rule 02

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(json?.error?.message || STRINGS.common.genericError) as any;
        error.code = json?.error?.code;
        error.status = response.status;
        throw error;
      }

      return { data: json as T, status: response.status };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. Please check your connection.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetches active showtimes for a movie grouped by cinema
   * GET /movies/:id/showtimes
   */
  public async getMovieShowtimes(movieId: string | number): Promise<MovieShowtimesResponse> {
    const { data } = await this.request<any>(`/movies/${movieId}/showtimes`, {
      method: 'GET',
    });
    return movieShowtimesResponseSchema.parse(data);
  }

  /**
   * Fetches real-time seat map (360 seats) with status (available, held, sold)
   * GET /showtimes/:id/seats
   */
  public async getSeatMap(showtimeId: string): Promise<SeatMapResponse> {
    const { data } = await this.request<any>(`/showtimes/${showtimeId}/seats`, {
      method: 'GET',
    });
    return seatMapResponseSchema.parse(data);
  }

  /**
   * Checks or joins the showtime waiting room
   * GET /showtimes/:id/waiting-room
   */
  public async getWaitingRoomStatus(showtimeId: string): Promise<WaitingRoomStatus> {
    const { data } = await this.request<any>(`/showtimes/${showtimeId}/waiting-room`, {
      method: 'GET',
    });
    return waitingRoomStatusSchema.parse(data);
  }

  /**
   * Acquires atomic multi-seat hold (max 6 seats)
   * POST /showtimes/:id/holds
   */
  public async holdSeats(
    showtimeId: string,
    seatIds: string[],
    waitingRoomPass?: string
  ): Promise<HoldSeatsResponse> {
    const payload: HoldSeatsBody = { seatIds, waitingRoomPass };
    holdSeatsBodySchema.parse(payload);

    const { data } = await this.request<any>(`/showtimes/${showtimeId}/holds`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return holdSeatsResponseSchema.parse(data);
  }

  /**
   * Releases previously held seats
   * DELETE /showtimes/:id/holds
   */
  public async releaseSeats(
    showtimeId: string,
    seatIds?: string[]
  ): Promise<{ success: boolean; releasedCount?: number }> {
    const payload: ReleaseHoldsBody = { seatIds };
    releaseHoldsBodySchema.parse(payload);

    const { data } = await this.request<any>(`/showtimes/${showtimeId}/holds`, {
      method: 'DELETE',
      body: JSON.stringify(payload),
    });
    return data;
  }

  /**
   * Initiates checkout with mandatory Idempotency-Key
   * POST /checkout
   */
  public async checkout(
    showtimeId: string,
    seatIds: string[],
    idempotencyKey: string
  ): Promise<CheckoutResponse> {
    const payload: CheckoutBody = { showtimeId, seatIds };
    checkoutBodySchema.parse(payload);

    const { data } = await this.request<any>(
      '/checkout',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      {
        'Idempotency-Key': idempotencyKey,
      }
    );
    return checkoutResponseSchema.parse(data);
  }

  /**
   * Fetches all tickets belonging to authenticated user
   * GET /tickets
   */
  public async getUserTickets(): Promise<UserTicketsResponse> {
    const { data } = await this.request<any>('/tickets', {
      method: 'GET',
    });
    return userTicketsResponseSchema.parse(data);
  }

  /**
   * Requests fresh 256-bit QR reference for ticket
   * POST /tickets/:id/qr
   */
  public async generateTicketQr(ticketId: string): Promise<GenerateQrResponse> {
    const { data } = await this.request<any>(`/tickets/${ticketId}/qr`, {
      method: 'POST',
    });
    return generateQrResponseSchema.parse(data);
  }
}

export const cinemaClient = new CinemaClient();

