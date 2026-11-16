import React, { useRef } from 'react';
import {
  Animated,
  ImageProps,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
} from 'react-native';

export interface PhotoFadeProps {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  decorative?: boolean;
  duration?: number;
  testID?: string;
  resizeMode?: ImageProps['resizeMode'];
}

/**
 * A VUE PhotoFade Component
 * Wraps a photo and smoothly fades it in on load using standard React Native Animated.Image.
 *
 * Rules:
 * - Fade duration: defaults to 250ms (matching MovieCard.tsx), as no duration token exists in design tokens.
 * - Decorative images (decorative=true) are not announced by screen readers (accessible=false, hidden).
 * - Meaningful images (decorative=false) keep accessibilityRole="image" and accessibilityLabel.
 * - No new libraries (uses React Native Animated with useNativeDriver: true).
 */
export const PhotoFade: React.FC<PhotoFadeProps> = ({
  source,
  style,
  accessibilityLabel,
  decorative = false,
  duration = 250,
  testID,
  resizeMode,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;

  const handleLoad = () => {
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.Image
      source={source}
      onLoad={handleLoad}
      style={[style, { opacity }]}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no' : 'auto'}
      testID={testID}
      resizeMode={resizeMode}
    />
  );
};
