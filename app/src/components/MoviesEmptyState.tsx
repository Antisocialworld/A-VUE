import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { EmptyState } from './EmptyState';
import { PhotoFade } from './PhotoFade';

export interface MoviesEmptyStateProps {
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE MoviesEmptyState Component
 * Shared empty state display featuring movies-empty.jpg via PhotoFade
 * and EmptyState with retry action and watermark.
 */
export const MoviesEmptyState: React.FC<MoviesEmptyStateProps> = ({
  onRetry,
  style,
  testID,
}) => {
  const { spacing, radius } = useTheme();

  return (
    <View
      testID={testID}
      style={[
        styles.centeredState,
        { padding: spacing.xl },
        style,
      ]}
    >
      <PhotoFade
        source={require('../../assets/photos/movies-empty.jpg')}
        decorative
        style={[
          styles.emptyPhoto,
          { borderRadius: radius.md, marginBottom: spacing.base },
        ]}
      />
      <EmptyState
        title={STRINGS.movies.emptyStateTitle}
        message={STRINGS.movies.emptyStateMessage}
        actionTitle={STRINGS.common.retry}
        onActionPress={onRetry}
        showWatermark
      />
    </View>
  );
};

const styles = StyleSheet.create({
  centeredState: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyPhoto: {
    width: '100%',
    maxWidth: 280,
    height: 160,
    alignSelf: 'center',
  },
});
