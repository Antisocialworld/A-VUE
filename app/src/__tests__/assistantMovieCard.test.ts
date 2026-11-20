import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantChatResponse } from '../api/assistantClient';
import { STRINGS } from '../constants/strings';

const appRoot = path.resolve(__dirname, '..');
const appEntry = path.resolve(__dirname, '../../App.tsx');
const appSrc = fs.readFileSync(appEntry, 'utf-8');
const cardPath = path.join(appRoot, 'components/AssistantMovieCard.tsx');
const chatPath = path.join(appRoot, 'components/AssistantChat.tsx');
const cardSrc = fs.readFileSync(cardPath, 'utf-8');
const chatSrc = fs.readFileSync(chatPath, 'utf-8');
const tmdbHost = ['image', 'tmdb', 'org'].join('.');

function productionSources(dir: string, fileList: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      productionSources(full, fileList);
    } else if (/\.tsx?$/.test(entry.name)) {
      fileList.push(full);
    }
  }
  return fileList;
}

const validMovie = {
  tmdbId: 123,
  title: 'Example',
  year: '2026',
  overview: 'A short overview.',
  posterPath: 'abc123.jpg',
};

describe('Ask A VUE movie card', () => {
  it('parses a valid optional movie without losing the reply text', () => {
    expect(
      parseAssistantChatResponse({ reply: 'Here is what I found.', movie: validMovie }),
    ).toEqual({ reply: 'Here is what I found.', movie: validMovie });

    expect(
      parseAssistantChatResponse({
        reply: 'Here is what I found.',
        movie: { ...validMovie, year: null, posterPath: null },
      }),
    ).toEqual({
      reply: 'Here is what I found.',
      movie: { ...validMovie, year: null, posterPath: null },
    });
  });

  it('ignores invalid movie shapes and still returns the reply text', () => {
    const invalidMovies = [
      { ...validMovie, tmdbId: '123' },
      { ...validMovie, posterPath: 42 },
      { ...validMovie, extra: true },
      null,
    ];

    for (const movie of invalidMovies) {
      expect(() => parseAssistantChatResponse({ reply: 'Plain reply', movie })).not.toThrow();
      expect(parseAssistantChatResponse({ reply: 'Plain reply', movie })).toEqual({
        reply: 'Plain reply',
      });
    }
  });

  it('still rejects malformed response envelopes', () => {
    expect(() => parseAssistantChatResponse({ reply: 7 })).toThrow();
    expect(() => parseAssistantChatResponse({ reply: 'Hi', unexpected: true })).toThrow();
  });

  it('keeps the TMDB host out of card source and all production app sources', () => {
    expect(cardSrc).not.toContain(tmdbHost);
    const sources = [...productionSources(appRoot)];
    if (fs.existsSync(appEntry)) sources.push(appEntry);
    for (const source of sources) {
      expect(fs.readFileSync(source, 'utf-8')).not.toContain(tmdbHost);
    }
  });

  it('uses the existing w342 poster proxy helper', () => {
    expect(cardSrc).toContain("moviesClient.getPosterUrl('w342', movie.posterPath)");
  });

  it('keeps the new labels in the strings file', () => {
    expect(STRINGS.assistant.movie.viewDetails).toBe('View details');
    expect(STRINGS.assistant.movie.viewDetailsAccessibilityLabel('Example')).toBe(
      'View details for Example',
    );
    expect(STRINGS.assistant.movie.posterAccessibilityLabel('Example')).toBe('Poster for Example');
    expect(cardSrc).toContain('{STRINGS.assistant.movie.viewDetails}');
    expect(cardSrc).toContain(
      'accessibilityLabel={STRINGS.assistant.movie.posterAccessibilityLabel(movie.title)}',
    );
  });

  it('renders an accessible four-line overview card with TMDB attribution', () => {
    expect(cardSrc).toContain('numberOfLines={4}');
    expect(cardSrc).toContain('minHeight: 44');
    expect(cardSrc).toContain("import { TmdbAttribution } from './TmdbAttribution';");
    expect(cardSrc).toContain('<TmdbAttribution />');
  });

  it('uses design tokens only', () => {
    expect(cardSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(cardSrc).toContain('colors.surface_container_low');
    expect(cardSrc).toContain('colors.on_primary');
  });

  it('uses the existing shadow token for the toast shadow, not a hex literal', () => {
    const toastSrc = fs.readFileSync(path.join(appRoot, 'components/Toast.tsx'), 'utf-8');
    const cleanSrc = toastSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(cleanSrc.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(toastSrc).toContain('shadowColor: shadows.medium.shadowColor');
  });

  it('stores the movie on assistant chat state without adding it to model history', () => {
    expect(chatSrc).toContain('movie?: AssistantMovie');
    expect(chatSrc).toContain('movie: result.movie');
    expect(chatSrc).toContain('<AssistantMovieCard movie={item.movie} onViewDetails={onOpenMovie} />');
    expect(chatSrc).toContain('text: m.text');
  });

  it('calls onOpenMovie with the card tmdbId when View details is tapped', () => {
    const handler = cardSrc.match(/const handleViewDetails = \(\) => \{([\s\S]*?)\n  \};/);
    expect(handler).not.toBeNull();
    const onViewDetails = vi.fn();
    // Execute the card's own tap handler body with mocked values: no renderer needed.
    new Function('onViewDetails', 'movie', 'posterUrl', 'releaseYear', handler![1])(
      onViewDetails,
      validMovie,
      '/poster.jpg',
      validMovie.year,
    );
    expect(onViewDetails).toHaveBeenCalledTimes(1);
    expect(onViewDetails).toHaveBeenCalledWith({
      movieId: validMovie.tmdbId,
      movieTitle: validMovie.title,
      posterUrl: '/poster.jpg',
      releaseYear: validMovie.year,
    });
  });

  it('wires the card handler to the one existing Movie Detail handler', () => {
    expect(appSrc).toContain('const handleSelectMovie: MovieSelectHandler');
    expect(appSrc).toContain('onSelectMovie={handleSelectMovie}');
    expect(appSrc).toContain('onOpenMovie={handleSelectMovie}');
    expect(fs.readFileSync(path.resolve(__dirname, '../screens/AskAssistantScreen.tsx'), 'utf-8')).toContain(
      'onOpenMovie={onOpenMovie}',
    );
    expect(fs.readFileSync(path.resolve(__dirname, '../components/AssistantPanel.tsx'), 'utf-8')).toContain(
      'onOpenMovie={onOpenMovie}',
    );
  });

  it('imports expo-clipboard only in the assistant movie card', () => {
    const sources = [...productionSources(appRoot)];
    if (fs.existsSync(appEntry)) sources.push(appEntry);
    const importers = sources.filter((source) =>
      /from ['"]expo-clipboard['"]/.test(fs.readFileSync(source, 'utf-8')),
    );
    expect(importers).toEqual([cardPath]);
    expect(cardSrc).toContain("import * as Clipboard from 'expo-clipboard';");
  });

  it('guards the poster long-press copy behind the native platform check', () => {
    expect(cardSrc).toContain(
      "onLongPress={Platform.OS !== 'web' ? handlePosterLongPress : undefined}",
    );
    expect(cardSrc).toContain('accessibilityHint={');
    expect(cardSrc).toContain('Clipboard.setImageAsync(base64)');
    expect(cardSrc).toContain("moviesClient.getPosterUrl('w342', movie.posterPath)");
  });

  it('keeps every new copy-image label in STRINGS', () => {
    const newStrings: Array<[keyof typeof STRINGS.assistant.movie, string]> = [
      ['posterLongPressHint', 'Long press the poster to copy it.'],
      ['copyImageTitle', 'Poster options'],
      ['copyImage', 'Copy image'],
      ['copyImageCancel', 'Cancel'],
      ['copyImageSuccess', 'Poster copied.'],
      ['copyImageFailure', 'The poster could not be copied. Try again.'],
    ];
    for (const [key, literal] of newStrings) {
      expect(STRINGS.assistant.movie[key]).toBe(literal);
      expect(cardSrc).toContain(`STRINGS.assistant.movie.${key}`);
      expect(cardSrc).not.toContain(`'${literal}'`);
    }
  });

  it('keeps View details and the attribution block while avoiding a direct TMDB host', () => {
    expect(cardSrc).toContain('{STRINGS.assistant.movie.viewDetails}');
    expect(cardSrc).toContain('<TmdbAttribution />');
    expect(cardSrc).not.toContain(tmdbHost);
  });
});
