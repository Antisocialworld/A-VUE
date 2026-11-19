import { describe, expect, it } from 'vitest';
import {
  MOVIE_LOOKUP_STOP_TITLES,
  WEAK_MATCH_MIN_SCORE,
  detectMovieIntent,
  extractMovieTitle,
  isSearchableMovieTitle,
  toMovieSummary,
} from '../lib/assistant/movieLookup.js';
import type { MovieDto } from '../schemas/movies.js';

describe('movieLookup intent and title extraction', () => {
  it.each([
    ['Can I see Spider-Man: Brand New Day poster?', 'Spider-Man: Brand New Day'],
    ['show me the poster of Dune', 'Dune'],
    ['what does Lord of the Rings look like', 'Lord of the Rings'],
    ['tell me about Inception', 'Inception'],
  ])('extracts the title from "%s"', (message, title) => {
    expect(detectMovieIntent(message)).not.toBe('none');
    expect(extractMovieTitle(message)).toBe(title);
  });

  it('does not trigger on procedural or greeting messages', () => {
    for (const message of ['How do I book tickets?', 'Hi', 'Thank you']) {
      expect(detectMovieIntent(message)).toBe('none');
      expect(extractMovieTitle(message)).toBeNull();
    }
  });

  it('does not treat bare "see" as a trigger', () => {
    expect(detectMovieIntent('see')).toBe('none');
  });

  it('rejects titles outside 2-100 characters', () => {
    expect(extractMovieTitle('show me A poster')).toBeNull();
    expect(extractMovieTitle(`show me ${'x'.repeat(101)} poster`)).toBeNull();
  });

  it('shapes the top result with file-name poster and bounded overview', () => {
    const movie: MovieDto = {
      id: 123,
      title: 'Example',
      overview: `${'word '.repeat(80)}tail`,
      releaseDate: '2026-11-19',
      runtimeMinutes: 120,
      genres: [],
      voteAverage: 7,
      posterPath: '/abc123.jpg',
      backdropPath: null,
    };

    const summary = toMovieSummary(movie);
    expect(summary).toMatchObject({
      tmdbId: 123,
      title: 'Example',
      year: '2026',
      posterPath: 'abc123.jpg',
    });
    expect(summary.overview.length).toBeLessThanOrEqual(300);
    expect(summary.overview.endsWith(' ')).toBe(false);
  });

  it('returns null for a message with no movie intent', () => {
    expect(extractMovieTitle('How do I book tickets?')).toBeNull();
    expect(extractMovieTitle('Hi')).toBeNull();
  });

  it('uses one weak-intent score constant and blocks generic titles', () => {
    expect(WEAK_MATCH_MIN_SCORE).toBe(0.85);
    for (const title of MOVIE_LOOKUP_STOP_TITLES) {
      expect(isSearchableMovieTitle(title)).toBe(false);
    }
    expect(isSearchableMovieTitle('Dune')).toBe(true);
  });
});
