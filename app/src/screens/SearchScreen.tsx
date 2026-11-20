import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { EmptyState, MovieCard, ScreenShell, SearchIcon, Skeleton } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { MovieDto } from '../schemas/movies';
import { moviesClient } from '../api/moviesClient';
import { getErrorCopy } from '../utils/error';
import { MovieSelectHandler } from './MoviesHomeScreen';

export interface SearchScreenProps {
  onBack: () => void;
  onSelectMovie: MovieSelectHandler;
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  onBack,
  onSelectMovie,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MovieDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [matchedTitle, setMatchedTitle] = useState<string | null>(null);

  // Sequence counter to discard stale out-of-order network responses
  const activeRequestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      activeRequestIdRef.current++;
      setResults([]);
      setLoading(false);
      setError(null);
      setHasSearched(false);
      setMatchedTitle(null);
      return;
    }

    const currentReqId = ++activeRequestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await moviesClient.searchMovies(trimmed);
      // Discard stale responses if a newer request was dispatched
      if (currentReqId === activeRequestIdRef.current) {
        setResults(response.movies);
        setHasSearched(true);
        setMatchedTitle(response.matchedTitle ?? null);
      }
    } catch (err: any) {
      if (currentReqId === activeRequestIdRef.current) {
        setError(err);
        setHasSearched(true);
        setMatchedTitle(null);
      }
    } finally {
      if (currentReqId === activeRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const handleChangeText = (text: string) => {
    setQuery(text);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      activeRequestIdRef.current++;
      setResults([]);
      setLoading(false);
      setError(null);
      setHasSearched(false);
      setMatchedTitle(null);
      return;
    }

    // 350 ms debounce
    debounceTimerRef.current = setTimeout(() => {
      performSearch(text);
    }, 350);
  };

  const handleClear = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    activeRequestIdRef.current++;
    setQuery('');
    setResults([]);
    setLoading(false);
    setError(null);
    setHasSearched(false);
    setMatchedTitle(null);
  };

  const handleRetry = () => {
    if (query.trim().length >= 2) {
      performSearch(query);
    }
  };

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleSelectMovie = useCallback(
    (movie: MovieDto) => {
      const releaseYear = movie.releaseDate
        ? movie.releaseDate.split('-')[0]
        : STRINGS.movies.tba;
      const posterUrl = movie.posterPath
        ? (moviesClient.getPosterUrl('w342', movie.posterPath) ?? undefined)
        : undefined;

      onSelectMovie({
        movieId: movie.id,
        movieTitle: movie.title,
        posterUrl,
        releaseYear,
        voteAverage: movie.voteAverage,
      });
    },
    [onSelectMovie],
  );

  const keyExtractor = useCallback((item: MovieDto) => String(item.id), []);

  const renderItem = useCallback(
    ({ item }: { item: MovieDto }) => (
      <View style={styles.cardWrapper}>
        <MovieCard movie={item} onPress={() => handleSelectMovie(item)} />
      </View>
    ),
    [handleSelectMovie],
  );

  const renderLoadingSkeletons = () => (
    <View style={[styles.gridContainer, { padding: spacing.base }]}>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <View
          key={key}
          style={[
            styles.skeletonCard,
            {
              borderRadius: radius.md,
              padding: spacing.sm,
              backgroundColor: colors.surface_container_low,
            },
          ]}
        >
          <Skeleton height={180} borderRadius={radius.sm} />
          <View style={{ marginTop: spacing.xs }}>
            <Skeleton height={16} width="80%" borderRadius={radius.sm} />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginTop: spacing.xs,
              }}
            >
              <Skeleton height={12} width="35%" borderRadius={radius.sm} />
              <Skeleton height={12} width="25%" borderRadius={radius.sm} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <ScreenShell
      title={STRINGS.search.header}
      onBack={onBack}
      scrollable={false}
      contentContainerStyle={styles.container}
    >
      {/* Search Input Bar */}
      <View
        style={[
          styles.searchBarContainer,
          {
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.sm,
          },
        ]}
      >
        <View
          style={[
            styles.searchInputWrapper,
            {
              backgroundColor: colors.surface_container_high,
              borderColor: colors.outline_variant,
              borderRadius: radius.full,
              paddingHorizontal: spacing.md,
            },
          ]}
        >
          <SearchIcon size={18} color={colors.on_surface_variant} />
          <TextInput
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            value={query}
            onChangeText={handleChangeText}
            placeholder={STRINGS.search.placeholder}
            placeholderTextColor={colors.on_surface_variant}
            accessibilityRole="search"
            accessibilityLabel={STRINGS.search.inputAccessibilityLabel}
            style={[
              styles.textInput,
              {
                color: colors.on_surface,
                fontFamily: typography.bodyLarge.fontFamily,
                fontSize: typography.bodyLarge.fontSize,
                marginLeft: spacing.sm,
              },
            ]}
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={STRINGS.search.clearAccessibilityLabel}
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.clearButton}
            >
              <View
                style={[
                  styles.clearCircle,
                  {
                    backgroundColor: colors.on_surface_variant,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.clearCross,
                    {
                      color: colors.surface_container_high,
                    },
                  ]}
                >
                  ✕
                </Text>
              </View>
            </Pressable>
          )}
        </View>
      </View>

      {matchedTitle ? (
        <View
          style={[
            styles.hintContainer,
            { paddingHorizontal: spacing.base, paddingTop: spacing.sm },
          ]}
        >
          <Text
            allowFontScaling
            accessibilityRole="text"
            numberOfLines={1}
            style={{
              color: colors.on_surface_variant,
              fontFamily: typography.bodySmall.fontFamily,
              fontSize: typography.bodySmall.fontSize,
              lineHeight: typography.bodySmall.lineHeight,
            }}
          >
            {STRINGS.search.showingResultsFor(matchedTitle)}
          </Text>
        </View>
      ) : null}

      {/* Main Content Area */}
      {loading ? (
        renderLoadingSkeletons()
      ) : error ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          {(() => {
            const errorCopy = getErrorCopy(error);
            return (
              <EmptyState
                title={errorCopy.title}
                message={errorCopy.body}
                actionTitle={STRINGS.errors.tryAgain}
                onActionPress={handleRetry}
                showWatermark={false}
              />
            );
          })()}
        </View>
      ) : hasSearched && results.length === 0 ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          <EmptyState
            title={STRINGS.search.noResultsTitle}
            message={STRINGS.search.noResultsMessage}
            showWatermark={false}
          />
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={keyExtractor}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={{
            padding: spacing.base,
            paddingBottom: spacing.xxl,
          }}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
        />
      ) : null}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBarContainer: {
    width: '100%',
  },
  hintContainer: {
    width: '100%',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    minHeight: 44,
    borderWidth: 1,
  },
  textInput: {
    flex: 1,
    height: '100%',
    padding: 0,
  },
  clearButton: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearCross: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  cardWrapper: {
    flex: 1,
    flexGrow: 0,
    flexBasis: '48%',
    maxWidth: '50%',
    marginBottom: 12,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  skeletonCard: {
    width: '48%',
    marginBottom: 12,
  },
  centeredState: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
