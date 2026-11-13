import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { MovieDto } from '../schemas/movies';
import { moviesClient } from '../api/moviesClient';
import { Skeleton } from './Skeleton';

export interface MovieCardProps {
  movie: MovieDto;
  onPress: (movieId: number) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE MovieCard Component
 * - Memoised with React.memo to prevent unnecessary re-renders in FlatList.
 * - Progressive image loading: shows Skeleton placeholder while loading, fades in smoothly via Animated.Image.
 * - Cached on device via native HTTP cache (Cache-Control: public, max-age=86400).
 * - No Reanimated transitions and no haptics per Task C.
 * - Adheres strictly to design tokens, minimum 44 pt touch targets, and accessibility requirements.
 */
const MovieCardInner: React.FC<MovieCardProps> = ({
  movie,
  onPress,
  style,
  testID,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const releaseYear = movie.releaseDate ? movie.releaseDate.split('-')[0] : 'TBA';
  const posterUrl = moviesClient.getPosterUrl('w342', movie.posterPath);

  const accessibilityLabel = STRINGS.movies.cardAccessibilityLabel(
    movie.title,
    releaseYear,
    movie.voteAverage,
  );

  const handlePress = useCallback(() => {
    onPress(movie.id);
  }, [movie.id, onPress]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.cardContainer,
        {
          backgroundColor: colors.surface_container_low,
          borderRadius: radius.md,
          padding: spacing.sm,
          opacity: pressed ? 0.85 : 1.0,
        },
        style,
      ]}
    >
      {/* Poster Image Container */}
      <View
        style={[
          styles.posterContainer,
          {
            backgroundColor: colors.surface_container_high,
            borderRadius: radius.sm,
          },
        ]}
      >
        {/* Placeholder Skeleton while loading */}
        {posterUrl && !imageLoaded && !imageError && (
          <Skeleton
            height="100%"
            borderRadius={radius.sm}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Animated fade-in image cached via device HTTP engine */}
        {posterUrl && !imageError ? (
          <Animated.Image
            source={{ uri: posterUrl }}
            accessibilityRole="image"
            accessibilityLabel={STRINGS.movies.posterAccessibilityLabel(movie.title)}
            style={[
              styles.posterImage,
              {
                borderRadius: radius.sm,
                opacity: fadeAnim,
              },
            ]}
            onLoad={handleImageLoad}
            onError={() => setImageError(true)}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.fallbackBlock, { padding: spacing.sm }]}>
            <Text
              allowFontScaling
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

      {/* Movie Metadata */}
      <View style={[styles.infoContainer, { marginTop: spacing.xs }]}>
        <Text
          allowFontScaling
          numberOfLines={2}
          style={[
            styles.title,
            {
              color: colors.on_surface,
              fontFamily: typography.titleSmall.fontFamily,
              fontSize: typography.titleSmall.fontSize,
              fontWeight: typography.titleSmall.fontWeight,
              lineHeight: typography.titleSmall.lineHeight,
              minHeight: typography.titleSmall.lineHeight * 2,
            },
          ]}
        >
          {movie.title}
        </Text>

        <View style={[styles.metaRow, { marginTop: spacing.xs }]}>
          <Text
            allowFontScaling
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
            style={[
              styles.rating,
              {
                color: colors.primary,
                fontFamily: typography.labelSmall.fontFamily,
                fontSize: typography.labelSmall.fontSize,
                fontWeight: '700',
                lineHeight: typography.labelSmall.lineHeight,
              },
            ]}
          >
            ★ {movie.voteAverage.toFixed(1)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

export const MovieCard = React.memo(MovieCardInner);

const styles = StyleSheet.create({
  cardContainer: {
    flex: 1,
    minHeight: 44, // Minimum 44 pt touch target
    width: '100%',
    overflow: 'hidden',
  },
  posterContainer: {
    width: '100%',
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  fallbackBlock: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackTitle: {
    textAlign: 'center',
  },
  infoContainer: {
    width: '100%',
    flex: 1,
    justifyContent: 'space-between',
  },
  title: {
    letterSpacing: -0.1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  year: {},
  rating: {},
});
