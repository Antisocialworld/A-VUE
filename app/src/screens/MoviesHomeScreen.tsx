import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, ScreenShell } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

export interface MoviesHomeScreenProps {
  onSignOut: () => void;
}

export const MoviesHomeScreen: React.FC<MoviesHomeScreenProps> = ({ onSignOut }) => {
  const { spacing, colors, mode } = useTheme();

  // Task 4: In dark mode use tone 60 (#FF5449, 5.85:1 contrast >= 4.5:1), in light mode keep colors.error
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

  return (
    <ScreenShell
      title={STRINGS.movies.header}
      headerRight={headerRight}
      scrollable={false}
      contentContainerStyle={styles.container}
    >
      <View style={[styles.content, { paddingVertical: spacing.xl }]}>
        <EmptyState
          title={STRINGS.movies.emptyStateTitle}
          message={STRINGS.movies.emptyStateMessage}
        />
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

