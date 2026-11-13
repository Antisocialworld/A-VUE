import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

const lockupDark: ImageSourcePropType = require('../../assets/logo/a-vue-logo-lockup-dark.png');
const lockupLight: ImageSourcePropType = require('../../assets/logo/a-vue-logo-lockup-light.png');

export interface LogoProps {
  size?: number;
  theme?: 'light' | 'dark';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}

/**
 * A VUE Logo Lockup Component
 * Renders the official brand lockup (clapperboard mark + "A VUE" wordmark).
 * Dark theme uses the dark file, light theme uses the light file.
 * Accessibility: accessibilityRole="image", label="A VUE"
 */
export const Logo: React.FC<LogoProps> = ({
  size = 140,
  theme,
  accessibilityLabel,
  style,
  imageStyle,
}) => {
  const { mode, radius } = useTheme();
  const activeTheme = theme || mode;

  const effectiveLabel = accessibilityLabel !== undefined ? accessibilityLabel : STRINGS.appName;
  if (!effectiveLabel || !effectiveLabel.trim()) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('Accessibility Violation: Logo must have a non-empty accessibilityLabel.');
    }
  }

  const imageSource = activeTheme === 'dark' ? lockupDark : lockupLight;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={effectiveLabel}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: radius.lg,
        },
        style,
      ]}
    >
      <Image
        source={imageSource}
        resizeMode="contain"
        accessible={false} // Accessibility handled by parent View
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: radius.lg,
          },
          imageStyle,
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

