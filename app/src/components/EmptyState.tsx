import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Button } from './Button';
import { ClapperMark } from './ClapperMark';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionTitle?: string;
  onActionPress?: () => void;
  showWatermark?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE EmptyState Component
 * Displays empty state messaging with optional faint brand watermark.
 * Watermark is strictly decorative: accessible={false}, aria-hidden={true}, pointerEvents="none".
 * Layout guarantees Refresh button is placed below the watermark wrapper with at least spacing.base clearance.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  actionTitle,
  onActionPress,
  showWatermark = false,
  style,
  testID,
}) => {
  const { colors, spacing, typography, radius, mode } = useTheme();
  const [cardWidth, setCardWidth] = useState<number>(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0 && width !== cardWidth) {
      setCardWidth(width);
    }
  };

  // Watermark sized to ~55% of card width per Task 5
  const watermarkSize = cardWidth > 0 ? Math.round(cardWidth * 0.55) : 180;
  // Opacity: 0.10 in dark, 0.08 in light (Task 5)
  const watermarkOpacity = mode === 'dark' ? 0.10 : 0.08;

  return (
    <View
      testID={testID}
      onLayout={handleLayout}
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
      {/* Wrapper containing ONLY watermark + title + message */}
      <View style={styles.textWrapper} testID="empty-state-text-wrapper">
        {showWatermark && (
          <View
            testID="empty-state-watermark"
            pointerEvents="none"
            accessible={false}
            aria-hidden={true}
            style={[
              styles.watermarkContainer,
              {
                width: watermarkSize,
                height: watermarkSize,
                marginLeft: -watermarkSize / 2,
                marginTop: -watermarkSize / 2,
                opacity: watermarkOpacity,
              },
            ]}
          >
            <ClapperMark size={watermarkSize} accessibilityLabel="" />
          </View>
        )}

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
              fontFamily: typography.bodyMedium.fontFamily,
              fontSize: typography.bodyMedium.fontSize,
              lineHeight: typography.bodyMedium.lineHeight,
            },
          ]}
        >
          {message}
        </Text>
      </View>

      {/* Button placed strictly outside and below the text wrapper */}
      {actionTitle && onActionPress && (
        <View
          testID="empty-state-action-row"
          style={[styles.buttonRow, { marginTop: spacing.base }]}
        >
          <Button
            title={actionTitle}
            onPress={onActionPress}
            variant="secondary"
            accessibilityLabel={actionTitle}
            style={styles.actionButton}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  textWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  watermarkContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 0,
  },
  title: {
    textAlign: 'center',
    letterSpacing: -0.2,
    zIndex: 1,
  },
  message: {
    textAlign: 'center',
    letterSpacing: -0.1,
    zIndex: 1,
  },
  buttonRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  actionButton: {
    minHeight: 44,
  },
});
