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

  it('App.tsx receives and sets all metadata in the shared onSelectMovie handler', () => {
    // The handler was extracted out of the Movies mount; assert the handler body itself,
    // not the JSX tag that now only references it.
    const handlerMatch = appSrc.match(/const handleSelectMovie: MovieSelectHandler = \([\s\S]*?\n  \};/);
    expect(handlerMatch).not.toBeNull();
    const handler = handlerMatch![0];

    // Each setter appears in both branches (object params from cards, positional from lists).
    for (const setter of [
      'setSelectedMoviePosterUrl(',
      'setSelectedMovieReleaseYear(',
      'setSelectedMovieVoteAverage(',
    ]) {
      expect(handler.split(setter).length - 1).toBe(2);
    }

    for (const mountName of ['MoviesHomeScreen', 'SearchScreen']) {
      const mountMatch = appSrc.match(new RegExp(`<${mountName}[\\s\\S]*?/>`));
      expect(mountMatch).not.toBeNull();
      expect(mountMatch![0]).toContain('onSelectMovie={handleSelectMovie}');
    }
    // The assistant card reuses the same handler through its pass-through prop.
    const assistantMount = appSrc.match(/<AskAssistantScreen[\s\S]*?\/>/);
    expect(assistantMount).not.toBeNull();
    expect(assistantMount![0]).toContain('onOpenMovie={handleOpenAssistantMovie}');
    const cardHandler = appSrc.match(/const handleOpenAssistantMovie[\s\S]*?\n  \};/);
    expect(cardHandler![0]).toContain('handleSelectMovie(params);');

    expect(moviesHomeSrc).toMatch(/export\s+type\s+MovieSelectHandler[\s\S]*?posterUrl\?:|export\s+interface\s+MovieSelectParams[\s\S]*?posterUrl\?:/);
  });
});
