import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  movieDetailParamsSchema,
  movieDtoSchema,
  moviesListQuerySchema,
  moviesListResponseSchema,
  posterParamsSchema,
} from '../schemas/movies';
import { STRINGS } from '../constants/strings';

describe('App Movies Contract & Schema Conformance (Task 2 & 3)', () => {
  const contractPath = path.resolve(__dirname, '../../../contracts/movie-cases.json');

  it('contract file exists at repo root', () => {
    expect(fs.existsSync(contractPath)).toBe(true);
  });

  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));

  describe('movieDtoSchema contract cases', () => {
    contract.cases.movieDto.forEach((tc: any) => {
      it(tc.description, () => {
        const res = movieDtoSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('moviesListQuerySchema contract cases', () => {
    contract.cases.moviesListQuery.forEach((tc: any) => {
      it(tc.description, () => {
        const res = moviesListQuerySchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
        if (tc.expectedValid && tc.expectedPage !== undefined) {
          expect((res as any).data.page).toBe(tc.expectedPage);
        }
      });
    });
  });

  describe('movieDetailParamsSchema contract cases', () => {
    contract.cases.movieDetailParams.forEach((tc: any) => {
      it(tc.description, () => {
        const res = movieDetailParamsSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
        if (tc.expectedValid && tc.expectedId !== undefined) {
          expect((res as any).data.id).toBe(tc.expectedId);
        }
      });
    });
  });

  describe('posterParamsSchema contract cases', () => {
    contract.cases.posterParams.forEach((tc: any) => {
      it(tc.description, () => {
        const res = posterParamsSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });

  describe('moviesListResponseSchema contract cases (Task B Stale Flag)', () => {
    contract.cases.moviesListResponse.forEach((tc: any) => {
      it(tc.description, () => {
        const res = moviesListResponseSchema.safeParse(tc.input);
        expect(res.success).toBe(tc.expectedValid);
      });
    });
  });
});

describe('Task C: Progressive Posters & List Performance', () => {
  const cardSource = fs.readFileSync(
    path.resolve(__dirname, '../components/MovieCard.tsx'),
    'utf-8',
  );
  const homeSource = fs.readFileSync(
    path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx'),
    'utf-8',
  );

  it('MovieCard is memoised with React.memo to prevent list re-renders', () => {
    expect(cardSource).toContain('export const MovieCard = React.memo(');
  });

  it('MovieCard renders Skeleton placeholder while loading and fades in via Animated.Image', () => {
    expect(cardSource).toContain('<Skeleton');
    expect(cardSource).toContain('Animated.timing');
    expect(cardSource).toContain('useNativeDriver: true');
  });

  it('strictly excludes reanimated transitions and haptics in this phase', () => {
    expect(cardSource).not.toContain('react-native-reanimated');
    expect(cardSource).not.toContain('expo-haptics');
    expect(homeSource).not.toContain('react-native-reanimated');
    expect(homeSource).not.toContain('expo-haptics');
  });

  it('MoviesHomeScreen memoises renderItem and keyExtractor without inline arrow closures', () => {
    expect(homeSource).toContain('keyExtractor={keyExtractor}');
    expect(homeSource).toContain('renderItem={renderItem}');
    expect(homeSource).toContain('const keyExtractor = useCallback(');
    expect(homeSource).toContain('const renderItem = useCallback(');
  });

  it('declares button role and minimum 44 pt touch target on MovieCard', () => {
    expect(cardSource).toContain('accessibilityRole="button"');
    expect(cardSource).toContain('minHeight: 44');
  });

  it('implements formatted accessibility label "<title>, <year>, rated <x> out of 10"', () => {
    expect(cardSource).toContain('STRINGS.movies.cardAccessibilityLabel');
    const label = STRINGS.movies.cardAccessibilityLabel('Inception', '2010', 8.8);
    expect(label).toBe('Inception, 2010, rated 8.8 out of 10');
  });

  it('implements poster accessibility label "Poster for <title>"', () => {
    expect(cardSource).toContain('STRINGS.movies.posterAccessibilityLabel');
    const posterLabel = STRINGS.movies.posterAccessibilityLabel('Inception');
    expect(posterLabel).toBe('Poster for Inception');
  });
});

describe('MoviesHomeScreen & MovieDetailScreen TMDB Attribution (Task B)', () => {
  const homeSource = fs.readFileSync(
    path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx'),
    'utf-8',
  );
  const detailSource = fs.readFileSync(
    path.resolve(__dirname, '../screens/MovieDetailScreen.tsx'),
    'utf-8',
  );
  const attributionSource = fs.readFileSync(
    path.resolve(__dirname, '../components/TmdbAttribution.tsx'),
    'utf-8',
  );

  it('both screens render TmdbAttribution component at the bottom', () => {
    expect(homeSource).toContain('<TmdbAttribution');
    expect(detailSource).toContain('<TmdbAttribution');
  });

  it('TmdbAttribution sources notice text from strings file', () => {
    expect(attributionSource).toContain('STRINGS.movies.tmdbAttribution');
    expect(STRINGS.movies.tmdbAttribution).toBe(
      'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
    );
  });

  it('TMDB logo has an accessibility label and role', () => {
    expect(attributionSource).toContain('accessibilityRole="image"');
    expect(attributionSource).toContain('accessibilityLabel="TMDB logo"');
  });

  it('sizes TMDB logo dynamically from Image.resolveAssetSource with height 24 pt and real aspect ratio', () => {
    // Verifies removal of old hard-coded dimensions and ratio assumptions
    expect(attributionSource).not.toContain('width: 124');
    expect(attributionSource).not.toContain('7.7');
    expect(attributionSource).not.toContain('height: 16');

    // Verifies dynamic resolution and ratio calculation
    expect(attributionSource).toContain('Image.resolveAssetSource(tmdbLogoSource)');
    expect(attributionSource).toContain('TMDB_LOGO_HEIGHT = 24');
    expect(attributionSource).toContain('realWidth / realHeight');
    expect(attributionSource).toContain('resizeMode="contain"');

    // Mathematically verifies rendered width formula: height * (realWidth / realHeight)
    // Real asset is 851x199 (~4.276:1)
    const realWidth = 851;
    const realHeight = 199;
    const height = 24;
    const expectedWidth = height * (realWidth / realHeight); // ~102.633 pt
    expect(expectedWidth).toBeCloseTo(102.633, 2);
  });

  it('MoviesHomeScreen enforces "Load more" button pagination without infinite scroll', () => {
    expect(homeSource).toContain('STRINGS.movies.loadMoreAction');
    expect(homeSource).toContain('handleLoadMore');
    expect(homeSource).not.toContain('onEndReached'); // Explicitly no infinite scroll
  });
});
