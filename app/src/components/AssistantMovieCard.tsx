import React, { useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { moviesClient } from '../api/moviesClient';
import type { AssistantMovie } from '../api/assistantClient';
import { TmdbAttribution } from './TmdbAttribution';
import { Toast } from './Toast';

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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const posterUrl = moviesClient.getPosterUrl('w342', movie.posterPath);
  const releaseYear = movie.year ?? STRINGS.movies.tba;

  const copyPosterImage = async () => {
    if (!posterUrl) return;
    try {
      // The poster URL is the app's own proxy route, never an upstream host.
      const response = await fetch(posterUrl);
      if (!response.ok) throw new Error('poster request failed');
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '');
          resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
        };
        reader.onerror = () => reject(new Error('poster read failed'));
        reader.readAsDataURL(blob);
      });
      await Clipboard.setImageAsync(base64);
      setToastMessage(STRINGS.assistant.movie.copyImageSuccess);
    } catch {
      setToastMessage(STRINGS.assistant.movie.copyImageFailure);
    }
  };

  const handlePosterLongPress = () => {
    Alert.alert(STRINGS.assistant.movie.copyImageTitle, undefined, [
      { text: STRINGS.assistant.movie.copyImageCancel, style: 'cancel' },
      { text: STRINGS.assistant.movie.copyImage, onPress: () => void copyPosterImage() },
    ]);
  };

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
        <Pressable
          accessibilityRole="image"
          accessibilityLabel={STRINGS.assistant.movie.posterAccessibilityLabel(movie.title)}
          accessibilityHint={
            Platform.OS !== 'web' ? STRINGS.assistant.movie.posterLongPressHint : undefined
          }
          onLongPress={Platform.OS !== 'web' ? handlePosterLongPress : undefined}
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
              accessible={false}
              accessibilityLabel={STRINGS.assistant.movie.posterAccessibilityLabel(movie.title)}
              resizeMode="cover"
              style={[styles.poster, { borderRadius: radius.sm }]}
            />
          ) : (
            <View style={[styles.posterFallback, { padding: spacing.sm }]}>
              <Text
                allowFontScaling
                selectable={Platform.OS !== 'web'}
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
        </Pressable>

        <View style={[styles.details, { gap: spacing.sm }]}>
          <Text
            allowFontScaling
            selectable={Platform.OS !== 'web'}
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
            selectable={Platform.OS !== 'web'}
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
            selectable={Platform.OS !== 'web'}
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

      <View style={{ marginTop: spacing.sm }}>
        <TmdbAttribution />
      </View>
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
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
