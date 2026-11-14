import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('A VUE Movies to Showtimes Props Propagation Contract', () => {
  const appPath = path.resolve(__dirname, '../../App.tsx');
  const moviesHomePath = path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx');

  const appSrc = fs.readFileSync(appPath, 'utf-8');
  const moviesHomeSrc = fs.readFileSync(moviesHomePath, 'utf-8');

  it('App.tsx declares state for movie posterUrl, releaseYear, and voteAverage', () => {
    expect(appSrc).toMatch(/const\s+\[selectedMoviePosterUrl,\s*setSelectedMoviePosterUrl\]\s*=\s*useState/);
    expect(appSrc).toMatch(/const\s+\[selectedMovieReleaseYear,\s*setSelectedMovieReleaseYear\]\s*=\s*useState/);
    expect(appSrc).toMatch(/const\s+\[selectedMovieVoteAverage,\s*setSelectedMovieVoteAverage\]\s*=\s*useState/);
  });

  it('App.tsx passes posterUrl, releaseYear and voteAverage to ShowtimesScreen', () => {
    const showtimesMountMatch = appSrc.match(/<ShowtimesScreen[\s\S]*?\/>/);
    expect(showtimesMountMatch).not.toBeNull();
    const showtimesMount = showtimesMountMatch![0];

    expect(showtimesMount).toContain('posterUrl={selectedMoviePosterUrl}');
    expect(showtimesMount).toContain('releaseYear={selectedMovieReleaseYear}');
    expect(showtimesMount).toContain('voteAverage={selectedMovieVoteAverage}');
  });

  it('the Movies selection callback carries posterUrl, releaseYear, and voteAverage', () => {
    // MoviesHomeScreen defines selection params interface
    expect(moviesHomeSrc).toMatch(/export\s+interface\s+MovieSelectParams\s*\{[\s\S]*?posterUrl\?:/);
    expect(moviesHomeSrc).toMatch(/export\s+interface\s+MovieSelectParams\s*\{[\s\S]*?releaseYear\?:/);
    expect(moviesHomeSrc).toMatch(/export\s+interface\s+MovieSelectParams\s*\{[\s\S]*?voteAverage\?:/);

    // handleSelectMovie derives posterUrl and releaseYear using card formatting
    expect(moviesHomeSrc).toContain("moviesClient.getPosterUrl('w342', movie.posterPath)");
    expect(moviesHomeSrc).toContain("movie.releaseDate.split('-')[0]");

    // onSelectMovie is invoked carrying all metadata
    expect(moviesHomeSrc).toMatch(/onSelectMovie\(\{[\s\S]*?movieId:[\s\S]*?posterUrl[\s\S]*?releaseYear[\s\S]*?voteAverage:\s*movie\.voteAverage/);
  });

  it('App.tsx receives and sets all metadata in onSelectMovie handler', () => {
    const moviesMountMatch = appSrc.match(/<MoviesHomeScreen[\s\S]*?\/>/);
    expect(moviesMountMatch).not.toBeNull();
    const moviesMount = moviesMountMatch![0];

    expect(moviesMount).toContain('setSelectedMoviePosterUrl');
    expect(moviesMount).toContain('setSelectedMovieReleaseYear');
    expect(moviesMount).toContain('setSelectedMovieVoteAverage');
  });
});
