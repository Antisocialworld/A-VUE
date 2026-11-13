import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionTitle?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  actionTitle,
  onActionPress,
  style,
  testID,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${message}`}
      style={[
        styles.container,
        {
          padding: spacing.xl,
          borderRadius: radius.lg,
          backgroundColor: colors.surface_container_low,
        },
        style,
      ]}
    >
      <Text
        allowFontScaling
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: colors.on_surface,
            marginBottom: spacing.xs,
            fontFamily: typography.titleLarge.fontFamily,
            fontSize: typography.titleLarge.fontSize,
            fontWeight: typography.titleLarge.fontWeight,
            lineHeight: typography.titleLarge.lineHeight,
          },
        ]}
      >
        {title}
      </Text>

      <Text
        allowFontScaling
        style={[
          styles.message,
          {
            color: colors.on_surface_variant,
            marginBottom: actionTitle ? spacing.lg : 0,
            fontFamily: typography.bodyMedium.fontFamily,
            fontSize: typography.bodyMedium.fontSize,
            lineHeight: typography.bodyMedium.lineHeight,
          },
        ]}
      >
        {message}
      </Text>

      {actionTitle && onActionPress && (
        <Button
          title={actionTitle}
          onPress={onActionPress}
          variant="secondary"
          style={styles.actionButton}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  message: {
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  actionButton: {
    marginTop: 8,
  },
});

