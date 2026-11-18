import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import {
  AccountMenu,
  Button,
  EmptyState,
  MovieCard,
  MoviesEmptyState,
  ScreenShell,
  SearchIcon,
  Skeleton,
  TicketIcon,
  TmdbAttribution,
} from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { MovieDto } from '../schemas/movies';
import { moviesClient } from '../api/moviesClient';
import { getErrorCopy } from '../utils/error';
import {
  getWebMovieColumns,
  WEB_GRID_GAP,
  WEB_GRID_SIDE_PADDING,
} from '../utils/webLayout';

export interface MovieSelectParams {
  movieId: number;
  movieTitle: string;
  posterUrl?: string;
  releaseYear?: string;
  voteAverage?: number;
}

export type MovieSelectHandler = (
  paramsOrId: MovieSelectParams | number,
  movieTitle?: string,
  posterUrl?: string,
  releaseYear?: string,
  voteAverage?: number,
) => void;

export interface MoviesHomeScreenProps {
  onSignOut: () => void;
  onSelectMovie: MovieSelectHandler;
  onNavigateToTickets?: () => void;
  onOpenSearch?: () => void;
  onOpenAssistant?: () => void;
}

export const MoviesHomeScreen: React.FC<MoviesHomeScreenProps> = ({
  onSignOut,
  onSelectMovie,
  onNavigateToTickets,
  onOpenSearch,
  onOpenAssistant,
}) => {
  const { spacing, colors, typography, mode, radius, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const webColumns = getWebMovieColumns(windowWidth);

  const [movies, setMovies] = useState<MovieDto[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);

  const headerRight = (
    <View style={styles.headerRightContainer}>
      {onOpenSearch && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={STRINGS.movies.searchActionAccessibilityLabel}
          accessibilityHint={STRINGS.movies.searchActionAccessibilityHint}
          onPress={onOpenSearch}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={({ pressed }) => [
            styles.searchButton,
            {
              backgroundColor: colors.surface_container_high,
              borderColor: colors.outline_variant,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <SearchIcon size={18} color={colors.on_surface_variant} />
        </Pressable>
      )}
      {onNavigateToTickets && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={STRINGS.tickets.myTicketsHeader}
          accessibilityHint="Navigates to your booked tickets"
          onPress={onNavigateToTickets}
          hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
          style={({ pressed }) => [
            styles.myTicketsPill,
            {
              backgroundColor: pressed ? colors.primary_text_high : colors.primary,
              borderRadius: radius.full,
              paddingHorizontal: spacing.sm,
            },
          ]}
        >
          <TicketIcon size={16} color={colors.on_primary} />
          <Text
            allowFontScaling
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.myTicketsText,
              {
                color: colors.on_primary,
                fontFamily: typography.labelLarge.fontFamily,
                fontSize: typography.labelLarge.fontSize,
                fontWeight: '700',
                marginLeft: spacing.xs,
              },
            ]}
          >
            {STRINGS.movies.ticketsPill}
          </Text>
        </Pressable>
      )}
      <AccountMenu onSignOut={onSignOut} />
    </View>
  );

  const fetchMovies = useCallback(async (targetPage = 1, isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (targetPage === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const response = await moviesClient.getMovies(targetPage);
      setMovies((prev) => (targetPage === 1 ? response.movies : [...prev, ...response.movies]));
      setPage(response.page);
      setTotalPages(response.totalPages);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchMovies(1);
  }, [fetchMovies]);

  const handleRefresh = () => {
    fetchMovies(1, true);
  };

  const handleLoadMore = () => {
    if (!loadingMore && page < totalPages && page < 5) {
      fetchMovies(page + 1);
    }
  };

  const handleRetry = () => {
    fetchMovies(1);
  };

  const handleSelectMovie = useCallback(
    (movieOrId: MovieDto | number) => {
      const movie =
        typeof movieOrId === 'number'
          ? movies.find((m) => m.id === movieOrId)
          : movieOrId;

      if (movie) {
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
      } else if (typeof movieOrId === 'number') {
        onSelectMovie({
          movieId: movieOrId,
          movieTitle: '',
        });
      }
    },
    [movies, onSelectMovie],
  );

  const keyExtractor = useCallback((item: MovieDto) => String(item.id), []);

  const renderItem = useCallback(
    ({ item }: { item: MovieDto }) => (
      <View
        style={[
          styles.cardWrapper,
          isWeb && {
            flexBasis: `${100 / webColumns}%`,
            maxWidth: `${100 / webColumns}%`,
            marginBottom: WEB_GRID_GAP,
          },
        ]}
      >
        <MovieCard movie={item} onPress={() => handleSelectMovie(item)} />
      </View>
    ),
    [handleSelectMovie, isWeb, webColumns],
  );

  // Native keeps its 2-column skeleton; web follows the same width-derived column rule.
  const renderLoadingSkeletons = () => {
    const skeletonCount = isWeb ? webColumns * 3 : 6;
    return (
      <View
        style={[
          styles.gridContainer,
          isWeb
            ? {
                padding: 0,
                paddingHorizontal: WEB_GRID_SIDE_PADDING,
                gap: WEB_GRID_GAP,
              }
            : { padding: spacing.base },
        ]}
      >
        {Array.from({ length: skeletonCount }, (_, key) => key).map((key) => (
          <View
            key={key}
            style={[
              styles.skeletonCard,
              isWeb && {
                width: `${100 / webColumns}%`,
                marginBottom: WEB_GRID_GAP,
              },
              { borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface_container_low },
            ]}
          >
            <Skeleton height={180} borderRadius={radius.sm} />
            <View style={{ marginTop: spacing.xs }}>
              <Skeleton height={16} width="80%" borderRadius={radius.sm} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                <Skeleton height={12} width="35%" borderRadius={radius.sm} />
                <Skeleton height={12} width="25%" borderRadius={radius.sm} />
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  };

  // Real outer horizontal inset of movie cards from screen edge:
  // ScreenShell fixed content padding (spacing.base) + FlatList contentContainerStyle padding (spacing.base) = 32 pt.
  const cardGridInset = spacing.base + spacing.base;
  const assistantFabBottom = Math.max(insets.bottom, spacing.base) + spacing.base;
  const listBottomPadding = spacing.xxl + (onOpenAssistant ? 88 : 0);

  return (
    <ScreenShell
      title={STRINGS.movies.header}
      titleAlign="left"
      headerInset={cardGridInset}
      headerRight={headerRight}
      scrollable={false}
      contentContainerStyle={{
        flex: 1,
        padding: spacing.base,
        ...(isWeb ? { padding: 0 } : null),
      }}
    >
      <View style={styles.container}>
        {loading && !refreshing ? (
          renderLoadingSkeletons()
        ) : error && movies.length === 0 ? (
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
        ) : movies.length === 0 ? (
          <MoviesEmptyState onRetry={handleRefresh} />
        ) : (
          <FlatList
            data={movies}
            keyExtractor={keyExtractor}
            numColumns={isWeb ? webColumns : 2}
            columnWrapperStyle={[
              { gap: spacing.md },
              isWeb && { gap: WEB_GRID_GAP },
            ]}
            contentContainerStyle={[
              {
                padding: spacing.base,
                paddingBottom: listBottomPadding,
              },
              isWeb && {
                padding: 0,
                paddingHorizontal: WEB_GRID_SIDE_PADDING,
                paddingBottom: listBottomPadding + WEB_GRID_GAP,
              },
            ]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            }
            renderItem={renderItem}
            ListFooterComponent={
              <View style={[styles.footerContainer, { marginTop: spacing.lg }]}>
                {/* Pagination by 'Load more' button (no infinite scroll per Task 3) */}
                {page < totalPages && page < 5 && (
                  <Button
                    title={STRINGS.movies.loadMoreAction}
                    onPress={handleLoadMore}
                    loading={loadingMore}
                    variant="secondary"
                    style={styles.loadMoreButton}
                  />
                )}

                {/* TMDB attribution requirement (Task B) */}
                <TmdbAttribution style={{ marginTop: spacing.xl }} />
              </View>
            }
          />
        )}

        {onOpenAssistant ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={STRINGS.assistant.fabAccessibilityLabel}
            onPress={onOpenAssistant}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            style={({ pressed }) => [
              shadows.medium,
              styles.assistantFab,
              {
                right: isWeb ? WEB_GRID_SIDE_PADDING : spacing.base,
                bottom: assistantFabBottom,
                backgroundColor: colors.primary,
                borderRadius: radius.full,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" accessible={false}>
              <Path
                d="M4 5.5C4 4.67157 4.67157 4 5.5 4H18.5C19.3284 4 20 4.67157 20 5.5V14.5C20 15.3284 19.3284 16 18.5 16H9L5.5 19V16H5.5C4.67157 16 4 15.3284 4 14.5V5.5Z"
                stroke={colors.on_primary}
                strokeWidth={1.8}
                strokeLinejoin="round"
                fill="none"
              />
              <Path
                d="M8 9H16M8 12H13.5"
                stroke={colors.on_primary}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
        ) : null}
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    flexWrap: 'nowrap',
    gap: 10,
  },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  myTicketsPill: {
    height: 36,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  myTicketsText: {
    letterSpacing: 0.1,
  },
  signOutPill: {
    height: 44,
    minHeight: 44,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  signOutText: {
    letterSpacing: 0.1,
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
  emptyPhoto: {
    width: '100%',
    maxWidth: 280,
    height: 160,
    alignSelf: 'center',
  },
  footerContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreButton: {
    minHeight: 44,
    width: '100%',
    maxWidth: 240,
  },
  tmdbAttribution: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  assistantFab: {
    position: 'absolute',
    width: 56,
    height: 56,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
});
