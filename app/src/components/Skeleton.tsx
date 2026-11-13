import React from 'react';
import { DimensionValue, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE Token-based Skeleton Component
 * Displays a non-interactive placeholder block while data is loading.
 * Strictly decorative: accessible={false}, aria-hidden={true}.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  borderRadius,
  style,
  testID,
}) => {
  const { colors, radius } = useTheme();

  return (
    <View
      testID={testID}
      accessible={false}
      aria-hidden={true}
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: borderRadius ?? radius.sm,
          backgroundColor: colors.surface_container_high,
        },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
});

