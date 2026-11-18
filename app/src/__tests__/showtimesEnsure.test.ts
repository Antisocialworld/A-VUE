import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../constants/strings';
import { ensureMovieShowtimesResponseSchema } from '../schemas/cinema';

describe('Showtimes ensure flow (screen logic)', () => {
  const screenSrc = fs.readFileSync(
    path.resolve(__dirname, '../screens/ShowtimesScreen.tsx'),
    'utf-8',
  );
  const clientSrc = fs.readFileSync(
    path.resolve(__dirname, '../api/cinemaClient.ts'),
    'utf-8',
  );

  it('adds an ensure request to the cinema client using POST', () => {
    expect(clientSrc).toContain('ensureMovieShowtimes');
    expect(clientSrc).toContain('`/movies/${movieId}/showtimes/ensure`');
    expect(clientSrc).toMatch(/ensureMovieShowtimes[\s\S]*?method:\s*'POST'/);
  });

  it('parses the ensure response with the shared schema', () => {
    expect(clientSrc).toContain('ensureMovieShowtimesResponseSchema.parse(data)');
  });

  it('only asks for showtimes when the first load returned none', () => {
    expect(screenSrc).toMatch(
      /if\s*\(data\.showtimes\.length\s*===\s*0\s*&&\s*!hasEnsuredRef\.current\)/,
    );
    expect(screenSrc).toContain('await cinemaClient.ensureMovieShowtimes(movieId)');
  });

  it('sets the once-per-visit guard before the ensure call', () => {
    const guardIndex = screenSrc.indexOf('hasEnsuredRef.current = true');
    const ensureIndex = screenSrc.indexOf('await cinemaClient.ensureMovieShowtimes(movieId)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(ensureIndex).toBeGreaterThan(guardIndex);
  });

  it('refetches showtimes after a successful ensure', () => {
    const ensureIndex = screenSrc.indexOf('await cinemaClient.ensureMovieShowtimes(movieId)');
    const refetchIndex = screenSrc.indexOf(
      'data = await cinemaClient.getMovieShowtimes(movieId)',
      ensureIndex,
    );
    expect(refetchIndex).toBeGreaterThan(ensureIndex);
  });

  it('guards every async state update with the active request id', () => {
    expect(screenSrc).toContain('const requestId = ++activeRequestIdRef.current');
    const guardMatches = screenSrc.match(
      /activeRequestIdRef\.current !== requestId/g,
    );
    expect(guardMatches).not.toBeNull();
    expect(guardMatches!.length).toBeGreaterThanOrEqual(4);
  });

  it('invalidates in-flight requests on unmount', () => {
    expect(screenSrc).toMatch(
      /return\s*\(\)\s*=>\s*\{[\s\S]*?activeRequestIdRef\.current \+= 1;/,
    );
  });

  it('shows a calm prep state while ensuring and a toast on rate limit', () => {
    expect(screenSrc).toContain('STRINGS.showtimes.preparingShowtimes');
    expect(screenSrc).toContain('STRINGS.showtimes.rateLimitToast');
    expect(screenSrc).toContain('STRINGS.showtimes.ensureFailedToast');
    expect(screenSrc).toContain('<Toast message={toastMessage}');
    expect(STRINGS.showtimes.preparingShowtimes).toBe('Finding showtimes…');
  });

  it('distinguishes a whole-movie empty list from an empty selected day', () => {
    expect(screenSrc).toContain('showtimes.length === 0');
    expect(screenSrc).toContain('STRINGS.showtimes.noShowtimesTitle');
    expect(screenSrc).toContain('STRINGS.showtimes.noShowtimesMessage');
    expect(screenSrc).toContain('STRINGS.showtimes.noShowtimesDayTitle');
  });

  it('keeps all new user-facing copy in the strings file', () => {
    expect(STRINGS.showtimes.noShowtimesTitle).toBe('No Showtimes Yet');
    expect(STRINGS.showtimes.noShowtimesMessage).toBe(
      'There are no showtimes for this movie right now. Please check back soon.',
    );
    expect(STRINGS.showtimes.rateLimitToast).toBe(
      'Showtime requests are busy. Wait a moment, then try again.',
    );
    expect(STRINGS.showtimes.ensureFailedToast).toBe(
      'We could not prepare showtimes. Please try again.',
    );
  });

  it('accepts the ensure response shape and rejects bad counts/reasons', () => {
    expect(ensureMovieShowtimesResponseSchema.safeParse({ created: 4 }).success).toBe(true);
    expect(
      ensureMovieShowtimesResponseSchema.safeParse({ created: 0, reason: 'CAP_REACHED' })
        .success,
    ).toBe(true);
    expect(ensureMovieShowtimesResponseSchema.safeParse({ created: -1 }).success).toBe(false);
    expect(
      ensureMovieShowtimesResponseSchema.safeParse({ created: 0, reason: 'UNKNOWN' }).success,
    ).toBe(false);
  });

  it('uses no random source in the new app code', () => {
    expect(screenSrc).not.toContain('Math.random');
    expect(clientSrc).not.toContain('Math.random');
  });
});
