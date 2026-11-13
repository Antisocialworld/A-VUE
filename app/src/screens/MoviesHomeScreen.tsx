import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
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
  TmdbAttribution,
} from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';
import { MovieDto } from '../schemas/movies';
import { moviesClient } from '../api/moviesClient';

export interface MoviesHomeScreenProps {
  onSignOut: () => void;
  onSelectMovie: (movieId: number) => void;
}

export const MoviesHomeScreen: React.FC<MoviesHomeScreenProps> = ({
  onSignOut,
  onSelectMovie,
}) => {
  const { spacing, colors, typography, mode, radius } = useTheme();

  const [movies, setMovies] = useState<MovieDto[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sign out button uses tone 60 in dark theme for >= 4.5:1 contrast
  const signOutColor = mode === 'dark' ? colorData.palettes.error['60'] : colors.error;

  const headerRight = (
    <Button
      title={STRINGS.movies.signOutAction}
      onPress={onSignOut}
      variant="text"
      textColor={signOutColor}
      accessibilityLabel={STRINGS.movies.signOutAction}
      accessibilityHint={STRINGS.movies.signOutAccessibilityHint}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    />
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
    (movieId: number) => {
      onSelectMovie(movieId);
    },
    [onSelectMovie],
  );

  const keyExtractor = useCallback((item: MovieDto) => String(item.id), []);

  const renderItem = useCallback(
    ({ item }: { item: MovieDto }) => (
      <View style={styles.cardWrapper}>
        <MovieCard movie={item} onPress={handleSelectMovie} />
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

  return (
    <ScreenShell
      title={STRINGS.movies.header}
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
