import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Button,
  EmptyState,
  MovieCard,
  ScreenShell,
  Skeleton,
  TicketIcon,
  TmdbAttribution,
} from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { MovieDto } from '../schemas/movies';
import { moviesClient } from '../api/moviesClient';

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
}

export const MoviesHomeScreen: React.FC<MoviesHomeScreenProps> = ({
  onSignOut,
  onSelectMovie,
  onNavigateToTickets,
}) => {
  const { spacing, colors, typography, mode, radius } = useTheme();

  const [movies, setMovies] = useState<MovieDto[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const headerRight = (
    <View style={[styles.headerRightContainer, { gap: spacing.sm }]}>
      {onNavigateToTickets && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={STRINGS.tickets.myTicketsHeader}
          accessibilityHint="Navigates to your booked tickets"
          onPress={onNavigateToTickets}
          style={({ pressed }) => [
            styles.myTicketsPill,
            {
              backgroundColor: pressed ? colors.primary_text_high : colors.primary,
              borderRadius: radius.full,
              paddingHorizontal: spacing.md,
            },
          ]}
        >
          <TicketIcon size={16} color={colors.on_primary} />
          <Text
            allowFontScaling
            numberOfLines={1}
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
            {STRINGS.tickets.myTicketsHeader}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={STRINGS.movies.signOutAction}
        accessibilityHint={STRINGS.movies.signOutAccessibilityHint}
        onPress={onSignOut}
        style={({ pressed }) => [
          styles.signOutPill,
          {
            borderRadius: radius.full,
            borderColor: pressed ? colors.outline : colors.outline_variant,
            backgroundColor: pressed ? colors.surface_container_high : 'transparent',
            paddingHorizontal: spacing.md,
          },
        ]}
      >
        <Text
          allowFontScaling
          numberOfLines={1}
          style={[
            styles.signOutText,
            {
              color: colors.on_surface_variant,
              fontFamily: typography.labelLarge.fontFamily,
              fontSize: typography.labelLarge.fontSize,
              fontWeight: '500',
            },
          ]}
        >
          {STRINGS.movies.signOutAction}
        </Text>
      </Pressable>
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
      setError(err.message || STRINGS.common.genericError);
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
      <View style={styles.cardWrapper}>
        <MovieCard movie={item} onPress={() => handleSelectMovie(item)} />
      </View>
    ),
    [handleSelectMovie],
  );

  // Render 6 skeleton cards in 2-column grid during initial load
  const renderLoadingSkeletons = () => (
    <View style={[styles.gridContainer, { padding: spacing.base }]}>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <View key={key} style={[styles.skeletonCard, { borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface_container_low }]}>
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

  // Real outer horizontal inset of movie cards from screen edge:
  // ScreenShell fixed content padding (spacing.base) + FlatList contentContainerStyle padding (spacing.base) = 32 pt.
  const cardGridInset = spacing.base + spacing.base;

  return (
    <ScreenShell
      title={STRINGS.movies.header}
      titleAlign="left"
      headerInset={cardGridInset}
      headerRight={headerRight}
      scrollable={false}
      contentContainerStyle={styles.container}
    >
      {loading && !refreshing ? (
        renderLoadingSkeletons()
      ) : error && movies.length === 0 ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          <EmptyState
            title={STRINGS.common.error}
            message={error}
            actionTitle={STRINGS.common.retry}
            onActionPress={handleRetry}
            showWatermark={false}
          />
        </View>
      ) : movies.length === 0 ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          <EmptyState
            title={STRINGS.movies.emptyStateTitle}
            message={STRINGS.movies.emptyStateMessage}
            actionTitle={STRINGS.common.retry}
            onActionPress={handleRefresh}
            showWatermark
          />
        </View>
      ) : (
        <FlatList
          data={movies}
          keyExtractor={keyExtractor}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={{
            padding: spacing.base,
            paddingBottom: spacing.xxl,
          }}
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
  },
  myTicketsPill: {
    height: 44,
    minHeight: 44,
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
});
