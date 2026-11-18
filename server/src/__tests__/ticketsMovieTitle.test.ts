import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db.js', () => ({ writerPool: { query: vi.fn() } }));
vi.mock('../lib/session.js', () => ({
  getSessionUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock('../env.js', () => ({ isAdmin: vi.fn() }));
vi.mock('../lib/tmdb.js', () => ({ getMovieDetails: vi.fn() }));

import { getMovieDetails } from '../lib/tmdb.js';
import { resolveTicketMovieTitles } from '../routes/tickets.js';

describe('GET /tickets movie title resolution (Z2)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('attaches title for a resolved movie id', async () => {
    vi.mocked(getMovieDetails).mockResolvedValue({
      movie: { id: 550, title: 'Fight Club' } as any,
      stale: false,
    });

    const titles = await resolveTicketMovieTitles(['550']);

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(getMovieDetails).toHaveBeenCalledWith(550);
    expect(titles.get('550')).toBe('Fight Club');
  });

  it('dedupes lookups across tickets of the same film', async () => {
    vi.mocked(getMovieDetails).mockResolvedValue({
      movie: { id: 550, title: 'Fight Club' } as any,
      stale: false,
    });

    const titles = await resolveTicketMovieTitles(['550', '550', '550']);

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(titles.get('550')).toBe('Fight Club');
  });

  it('omits title when lookup returns null (404/not found) without failing', async () => {
    vi.mocked(getMovieDetails).mockResolvedValue(null as any);

    const titles = await resolveTicketMovieTitles(['550']);

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(titles.has('550')).toBe(false);
    expect(titles.size).toBe(0);
  });

  it('omits title when lookup throws without failing', async () => {
    vi.mocked(getMovieDetails).mockRejectedValue(new Error('boom'));

    const titles = await resolveTicketMovieTitles(['550']);

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(titles.has('550')).toBe(false);
  });

  it('omits title when lookup reports TMDB_UNAVAILABLE without failing', async () => {
    vi.mocked(getMovieDetails).mockRejectedValue(new Error('TMDB_UNAVAILABLE'));

    const titles = await resolveTicketMovieTitles(['550']);

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(titles.has('550')).toBe(false);
  });

  it('omits title when lookup times out without failing', async () => {
    vi.useFakeTimers();
    vi.mocked(getMovieDetails).mockImplementation(() => new Promise(() => {}));

    const promise = resolveTicketMovieTitles(['550']);
    await vi.advanceTimersByTimeAsync(2000);
    const titles = await promise;

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(titles.has('550')).toBe(false);
  });

  it('caps unique id lookups per request', async () => {
    vi.mocked(getMovieDetails).mockImplementation(async (id: number) => ({
      movie: { id, title: `Movie ${id}` } as any,
      stale: false,
    }));

    const ids = Array.from({ length: 30 }, (_, i) => String(100 + i));
    const titles = await resolveTicketMovieTitles(ids);

    expect(getMovieDetails).toHaveBeenCalledTimes(25);
    expect(titles.size).toBe(25);
    expect(titles.get('100')).toBe('Movie 100');
    expect(titles.get('124')).toBe('Movie 124');
    expect(titles.has('125')).toBe(false);
  });
});
