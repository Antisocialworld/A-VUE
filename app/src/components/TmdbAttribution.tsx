import React from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

// Official owner-supplied TMDB brand asset (API Terms of Use, Section 3)
const tmdbLogoSource = require('../../assets/tmdb/tmdb-logo.png');

// Rendered height about 24 pt; visibly less prominent than the A VUE mark / title
export const TMDB_LOGO_HEIGHT = 24;

// Dynamically resolve real pixel dimensions from asset (owner-supplied 851x199, ~4.28:1)
const resolvedAsset = Image.resolveAssetSource(tmdbLogoSource);
const realWidth = resolvedAsset?.width && resolvedAsset.width > 0 ? resolvedAsset.width : 851;
const realHeight = resolvedAsset?.height && resolvedAsset.height > 0 ? resolvedAsset.height : 199;
export const TMDB_LOGO_WIDTH = TMDB_LOGO_HEIGHT * (realWidth / realHeight);

export interface TmdbAttributionProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE TmdbAttribution Component
 * Renders the official TMDB logo and mandatory attribution statement.
 * - TMDB logo is unmodified, un-recoloured, and keeps its native aspect ratio.
 * - Real asset dimensions dynamically read via Image.resolveAssetSource (851x199, ~4.28:1).
 * - Rendered height: 24 pt, width: height * (real width / real height) (~102.63 pt).
 * - Visibly smaller and less prominent than the A VUE brand mark/title.
 * - Notice text strictly sourced from STRINGS.movies.tmdbAttribution.
 */
export const TmdbAttribution: React.FC<TmdbAttributionProps> = ({
  style,
  testID,
}) => {
  const { colors, spacing, typography } = useTheme();

  return (
    <View
      testID={testID || 'tmdb-attribution'}
      accessible={true}
      accessibilityRole="none"
      style={[styles.container, style]}
    >
      <Image
        source={tmdbLogoSource}
        accessibilityRole="image"
        accessibilityLabel="TMDB logo"
        resizeMode="contain"
        style={styles.logo}
      />
      <Text
        allowFontScaling
        style={[
          styles.noticeText,
          {
            color: colors.on_surface_variant,
            marginTop: spacing.xs,
            fontFamily: typography.labelSmall.fontFamily,
            fontSize: typography.labelSmall.fontSize,
            lineHeight: typography.labelSmall.lineHeight,
          },
        ]}
      >
        {STRINGS.movies.tmdbAttribution}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  logo: {
    height: TMDB_LOGO_HEIGHT,
    width: TMDB_LOGO_WIDTH,
  },
  noticeText: {
    textAlign: 'center',
  },
});

