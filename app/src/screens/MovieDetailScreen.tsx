import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, EmptyState, ScreenShell, Skeleton, TmdbAttribution } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { MovieDto } from '../schemas/movies';
import { moviesClient } from '../api/moviesClient';

export interface MovieDetailScreenProps {
  movieId: number;
  onBack: () => void;
  onGetTickets?: (movieId: number, movieTitle: string) => void;
}

/**
 * A VUE MovieDetailScreen
 * Displays detailed information about a selected movie.
 * Adheres strictly to design tokens, font scaling, and accessibility standards.
 */
export const MovieDetailScreen: React.FC<MovieDetailScreenProps> = ({
  movieId,
  onBack,
  onGetTickets,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [movie, setMovie] = useState<MovieDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<boolean>(false);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    setImageError(false);

    try {
      const data = await moviesClient.getMovie(movieId);
      setMovie(data);
    } catch (err: any) {
      setError(err.message || STRINGS.common.genericError);
    } finally {
      setLoading(false);
    }
  }, [movieId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const backdropUrl = movie
    ? moviesClient.getPosterUrl('w500', movie.backdropPath || movie.posterPath)
    : null;
  const releaseYear = movie?.releaseDate ? movie.releaseDate.split('-')[0] : 'TBA';

  return (
    <ScreenShell
      title={STRINGS.appName}
      onBack={onBack}
      scrollable={false}
      contentContainerStyle={[styles.container, { padding: 0 }]}
    >
      {loading ? (
        <View style={[styles.skeletonContainer, { padding: spacing.base }]}>
          {/* Backdrop Skeleton */}
          <Skeleton height={220} borderRadius={radius.md} />

          {/* Title Skeleton */}
          <View style={{ marginTop: spacing.lg }}>
            <Skeleton height={28} width="75%" borderRadius={radius.sm} />
            <Skeleton height={16} width="40%" borderRadius={radius.sm} style={{ marginTop: spacing.xs }} />
          </View>

          {/* Metadata Skeleton */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Skeleton height={24} width={60} borderRadius={radius.sm} />
            <Skeleton height={24} width={80} borderRadius={radius.sm} />
            <Skeleton height={24} width={50} borderRadius={radius.sm} />
          </View>

          {/* Overview Skeleton */}
          <View style={{ marginTop: spacing.xl }}>
            <Skeleton height={20} width="30%" borderRadius={radius.sm} />
            <Skeleton height={14} width="100%" borderRadius={radius.sm} style={{ marginTop: spacing.sm }} />
            <Skeleton height={14} width="95%" borderRadius={radius.sm} style={{ marginTop: spacing.xs }} />
            <Skeleton height={14} width="90%" borderRadius={radius.sm} style={{ marginTop: spacing.xs }} />
          </View>
        </View>
      ) : error || !movie ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          <EmptyState
            title={STRINGS.common.error}
            message={error || STRINGS.common.genericError}
            actionTitle={STRINGS.common.retry}
            onActionPress={fetchDetails}
          />
        </View>
      ) : (
        <View style={styles.detailWrapper}>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { padding: spacing.base, paddingBottom: spacing.xxl },
            ]}
          >
            {/* Backdrop / Poster Media */}
            <View
              style={[
                styles.backdropContainer,
                {
                  backgroundColor: colors.surface_container_high,
                  borderRadius: radius.md,
                },
              ]}
            >
              {backdropUrl && !imageError ? (
                <Image
                  source={{ uri: backdropUrl }}
                  accessibilityRole="image"
                  accessibilityLabel={STRINGS.movies.posterAccessibilityLabel(movie.title)}
                  style={[styles.backdropImage, { borderRadius: radius.md }]}
                  onError={() => setImageError(true)}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.fallbackBackdrop, { padding: spacing.lg }]}>
                  <Text
                    allowFontScaling
                    style={[
                      styles.fallbackTitle,
                      {
                        color: colors.on_surface_variant,
                        fontFamily: typography.titleMedium.fontFamily,
                        fontSize: typography.titleMedium.fontSize,
                        lineHeight: typography.titleMedium.lineHeight,
                      },
                    ]}
                  >
                    {movie.title}
                  </Text>
                </View>
              )}
            </View>

            {/* Title & Core Metadata */}
            <View style={[styles.headerSection, { marginTop: spacing.lg }]}>
              <Text
                allowFontScaling
                accessibilityRole="header"
                style={[
                  styles.title,
                  {
                    color: colors.on_surface,
                    fontFamily: typography.headlineSmall.fontFamily,
                    fontSize: typography.headlineSmall.fontSize,
                    fontWeight: typography.headlineSmall.fontWeight,
                    lineHeight: typography.headlineSmall.lineHeight,
                  },
                ]}
              >
                {movie.title}
              </Text>

              <View style={[styles.metaRow, { marginTop: spacing.xs }]}>
                <Text
                  allowFontScaling
                  style={[
                    styles.metaText,
                    {
                      color: colors.on_surface_variant,
                      fontFamily: typography.bodyMedium.fontFamily,
                      fontSize: typography.bodyMedium.fontSize,
                      lineHeight: typography.bodyMedium.lineHeight,
                    },
                  ]}
                >
                  {releaseYear}
                </Text>

                {movie.runtimeMinutes && (
                  <>
                    <Text style={[styles.metaDot, { color: colors.on_surface_variant }]}>•</Text>
                    <Text
                      allowFontScaling
                      style={[
                        styles.metaText,
                        {
                          color: colors.on_surface_variant,
                          fontFamily: typography.bodyMedium.fontFamily,
                          fontSize: typography.bodyMedium.fontSize,
                          lineHeight: typography.bodyMedium.lineHeight,
                        },
                      ]}
                    >
                      {STRINGS.movieDetail.runtime(movie.runtimeMinutes)}
                    </Text>
                  </>
                )}

                <Text style={[styles.metaDot, { color: colors.on_surface_variant }]}>•</Text>
                <Text
                  allowFontScaling
                  style={[
                    styles.ratingText,
                    {
                      color: colors.primary,
                      fontFamily: typography.labelMedium.fontFamily,
                      fontSize: typography.labelMedium.fontSize,
                      fontWeight: '700',
                      lineHeight: typography.labelMedium.lineHeight,
                    },
                  ]}
                >
                  ★ {movie.voteAverage.toFixed(1)}/10
                </Text>
              </View>
            </View>

            {/* Genre Badges */}
            {movie.genres.length > 0 && (
              <View style={[styles.genresRow, { marginTop: spacing.md }]}>
                {movie.genres.map((genre) => (
                  <View
                    key={genre}
                    style={[
                      styles.genreBadge,
                      {
                        backgroundColor: colors.surface_container_high,
                        borderRadius: radius.sm,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: spacing.xs,
                      },
                    ]}
                  >
                    <Text
                      allowFontScaling
                      style={[
                        styles.genreText,
                        {
                          color: colors.on_surface,
                          fontFamily: typography.labelSmall.fontFamily,
                          fontSize: typography.labelSmall.fontSize,
                          lineHeight: typography.labelSmall.lineHeight,
                        },
                      ]}
                    >
                      {genre}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Overview / Synopsis */}
            <View style={[styles.overviewSection, { marginTop: spacing.xl }]}>
              <Text
                allowFontScaling
                accessibilityRole="header"
                style={[
                  styles.overviewHeader,
                  {
                    color: colors.on_surface,
                    fontFamily: typography.titleMedium.fontFamily,
                    fontSize: typography.titleMedium.fontSize,
                    fontWeight: typography.titleMedium.fontWeight,
                    lineHeight: typography.titleMedium.lineHeight,
                    marginBottom: spacing.xs,
                  },
                ]}
              >
                {STRINGS.movieDetail.overviewHeader}
              </Text>

              <Text
                allowFontScaling
                style={[
                  styles.overviewBody,
                  {
                    color: colors.on_surface_variant,
                    fontFamily: typography.bodyMedium.fontFamily,
                    fontSize: typography.bodyMedium.fontSize,
                    lineHeight: typography.bodyMedium.lineHeight,
                  },
                ]}
              >
                {movie.overview || STRINGS.movieDetail.noOverview}
              </Text>
            </View>

            {/* TMDB attribution requirement (Task B) */}
            <TmdbAttribution style={{ marginTop: spacing.xxl }} />
          </ScrollView>

          {/* Sticky "Get tickets" bottom action bar (Task 1) */}
          <View
            style={[
              styles.stickyFooter,
              {
                backgroundColor: colors.surface_container_low,
                borderTopColor: colors.outline_variant,
                padding: spacing.base,
              },
            ]}
          >
            <Button
              title={STRINGS.movieDetail.getTicketsAction}
              onPress={() => onGetTickets?.(movie.id, movie.title)}
              variant="primary"
              accessibilityLabel={`${STRINGS.movieDetail.getTicketsAction} for ${movie.title}`}
              style={styles.getTicketsButton}
            />
          </View>
        </View>
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  detailWrapper: {
    flex: 1,
  },
  skeletonContainer: {
    width: '100%',
  },
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
  },
  backdropContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropImage: {
    width: '100%',
    height: '100%',
  },
  fallbackBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackTitle: {
    textAlign: 'center',
  },
  headerSection: {
    width: '100%',
  },
  title: {
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaText: {},
  metaDot: {
    marginHorizontal: 8,
  },
  ratingText: {},
  genresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreBadge: {
    alignSelf: 'flex-start',
  },
  genreText: {},
  overviewSection: {
    width: '100%',
  },
  overviewHeader: {
    letterSpacing: -0.1,
  },
  overviewBody: {
    letterSpacing: -0.1,
  },
  tmdbAttribution: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  stickyFooter: {
    width: '100%',
    borderTopWidth: 1,
  },
  getTicketsButton: {
    width: '100%',
    minHeight: 48,
  },
});

