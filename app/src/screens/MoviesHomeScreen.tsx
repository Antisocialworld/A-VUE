import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, ScreenShell } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

export interface MoviesHomeScreenProps {
  onSignOut: () => void;
}

export const MoviesHomeScreen: React.FC<MoviesHomeScreenProps> = ({ onSignOut }) => {
  const { spacing } = useTheme();

  const headerRight = (
    <Button
      title={STRINGS.movies.signOutAction}
      onPress={onSignOut}
      variant="text"
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

