import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { moviesClient } from '../api/moviesClient';
import type { AssistantMovie } from '../api/assistantClient';
import { TmdbAttribution } from './TmdbAttribution';

export type AssistantMovieViewDetailsParams = {
  movieId: number;
  movieTitle: string;
  posterUrl?: string;
  releaseYear?: string;
  voteAverage?: number;
};

export interface AssistantMovieCardProps {
  movie: AssistantMovie;
  onViewDetails?: (params: AssistantMovieViewDetailsParams) => void;
  testID?: string;
}

/** Movie result card shared by the native chat screen and the wide-web assistant panel. */
export const AssistantMovieCard: React.FC<AssistantMovieCardProps> = ({
  movie,
  onViewDetails,
  testID,
}) => {
  const { colors, spacing, typography, radius } = useTheme();
  const posterUrl = moviesClient.getPosterUrl('w342', movie.posterPath);
  const releaseYear = movie.year ?? STRINGS.movies.tba;

  const handleViewDetails = () => {
    onViewDetails?.({
      movieId: movie.tmdbId,
      movieTitle: movie.title,
      posterUrl: posterUrl ?? undefined,
      releaseYear,
    });
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="none"
      accessibilityLabel={STRINGS.assistant.movie.cardAccessibilityLabel(movie.title)}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface_container_low,
          borderRadius: radius.md,
          marginTop: spacing.sm,
          padding: spacing.sm,
        },
      ]}
    >
      <View style={[styles.contentRow, { gap: spacing.sm }]}>
        <View
          style={[
            styles.posterContainer,
            {
              backgroundColor: colors.surface_container_high,
              borderRadius: radius.sm,
            },
          ]}
        >
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              accessibilityRole="image"
              accessibilityLabel={STRINGS.assistant.movie.posterAccessibilityLabel(movie.title)}
              resizeMode="cover"
              style={[styles.poster, { borderRadius: radius.sm }]}
            />
          ) : (
            <View style={[styles.posterFallback, { padding: spacing.sm }]}>
              <Text
                allowFontScaling
                accessibilityRole="text"
                accessibilityLabel={STRINGS.assistant.movie.titleAccessibilityLabel(movie.title)}
                numberOfLines={3}
                style={[
                  styles.fallbackTitle,
                  {
                    color: colors.on_surface_variant,
                    fontFamily: typography.labelSmall.fontFamily,
                    fontSize: typography.labelSmall.fontSize,
                    lineHeight: typography.labelSmall.lineHeight,
                  },
                ]}
              >
                {movie.title}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.details, { gap: spacing.xs }]}>
          <Text
            allowFontScaling
            accessibilityRole="text"
            accessibilityLabel={STRINGS.assistant.movie.titleAccessibilityLabel(movie.title)}
            numberOfLines={2}
            style={[
              styles.title,
              {
                color: colors.on_surface,
                fontFamily: typography.titleSmall.fontFamily,
                fontSize: typography.titleSmall.fontSize,
                fontWeight: typography.titleSmall.fontWeight,
                lineHeight: typography.titleSmall.lineHeight,
              },
            ]}
          >
            {movie.title}
          </Text>

          <Text
            allowFontScaling
            accessibilityRole="text"
            accessibilityLabel={STRINGS.assistant.movie.yearAccessibilityLabel(releaseYear)}
            style={[
              styles.year,
              {
                color: colors.on_surface_variant,
                fontFamily: typography.bodySmall.fontFamily,
                fontSize: typography.bodySmall.fontSize,
                lineHeight: typography.bodySmall.lineHeight,
              },
            ]}
          >
            {releaseYear}
          </Text>

          <Text
            allowFontScaling
            accessibilityRole="text"
            accessibilityLabel={STRINGS.assistant.movie.overviewAccessibilityLabel(movie.title)}
            numberOfLines={4}
            style={[
              styles.overview,
              {
                color: colors.on_surface,
                fontFamily: typography.bodySmall.fontFamily,
                fontSize: typography.bodySmall.fontSize,
                lineHeight: typography.bodySmall.lineHeight,
              },
            ]}
          >
            {movie.overview}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={STRINGS.assistant.movie.viewDetailsAccessibilityLabel(movie.title)}
            accessibilityState={{ disabled: !onViewDetails }}
            disabled={!onViewDetails}
            onPress={handleViewDetails}
            style={({ pressed }) => [
              styles.viewDetailsButton,
              {
                backgroundColor: colors.primary,
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                opacity: !onViewDetails || pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text
              allowFontScaling
              accessibilityRole="text"
              accessibilityLabel={STRINGS.assistant.movie.viewDetails}
              style={{
                color: colors.on_primary,
                fontFamily: typography.labelMedium.fontFamily,
                fontSize: typography.labelMedium.fontSize,
                fontWeight: typography.labelMedium.fontWeight,
              }}
            >
              {STRINGS.assistant.movie.viewDetails}
            </Text>
          </Pressable>
        </View>
      </View>

      <TmdbAttribution />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    overflow: 'hidden',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  posterContainer: {
    width: 96,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackTitle: {
    textAlign: 'center',
  },
  details: {
    flex: 1,
  },
  title: {},
  year: {},
  overview: {},
  viewDetailsButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
