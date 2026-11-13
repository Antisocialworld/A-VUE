import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Logo, ScreenShell } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

export interface WelcomeScreenProps {
  onNavigateToSignIn: () => void;
  onNavigateToSignUp: () => void;
  onNavigateToGallery?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onNavigateToSignIn,
  onNavigateToSignUp,
  onNavigateToGallery,
}) => {
  const { colors, spacing, typography } = useTheme();

  return (
    <ScreenShell scrollable={false} contentContainerStyle={styles.shellContent}>
      <View style={styles.centerContainer}>
        {/* Hidden gesture to access component gallery: long-press logo for 2 seconds (PRD section 3 item 7) */}
        <Pressable
          onLongPress={onNavigateToGallery}
          delayLongPress={2000}
          accessible={false}
          style={{ marginBottom: spacing.xl }}
        >
          <Logo
            size={160}
            accessibilityLabel={STRINGS.appName}
          />
        </Pressable>

        {/* Tagline */}
        <Text
          allowFontScaling
          style={[
            styles.tagline,
            {
              color: colors.on_surface_variant,
              marginBottom: spacing.xxl,
              fontFamily: typography.titleMediumIncreased.fontFamily,
              fontSize: typography.titleMediumIncreased.fontSize,
              lineHeight: typography.titleMediumIncreased.lineHeight,
            },
          ]}
        >
          {STRINGS.welcome.subtitle}
        </Text>
      </View>

      {/* Action Buttons */}
      <View
        style={[
          styles.actionsContainer,
          {
            paddingBottom: spacing.lg,
          },
        ]}
      >
        <Button
          title={STRINGS.welcome.signInAction}
          onPress={onNavigateToSignIn}
          variant="primary"
          accessibilityHint={STRINGS.welcome.signInAccessibilityHint}
          style={{ marginBottom: spacing.md }}
        />

        <Button
          title={STRINGS.welcome.signUpAction}
          onPress={onNavigateToSignUp}
          variant="secondary"
          accessibilityHint={STRINGS.welcome.signUpAccessibilityHint}
          style={{ marginBottom: spacing.lg }}
        />
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  shellContent: {
    justifyContent: 'space-between',
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagline: {
    textAlign: 'center',
    letterSpacing: -0.15,
  },
  actionsContainer: {
    width: '100%',
  },
});
