import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
  /** Keep the toast in normal layout flow (e.g. above a clipped card) instead of floating over it. */
  inline?: boolean;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  onDismiss,
  durationMs = 4000,
  inline = false,
}) => {
  const { colors, spacing, typography, radius, shadows } = useTheme();
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;

    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        onDismiss();
      });
    }, durationMs);

    return () => clearTimeout(timer);
  }, [message, durationMs, opacityAnim, onDismiss]);

  if (!message) return null;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.toastContainer,
        !inline && styles.overlayPosition,
        inline && { marginBottom: spacing.sm },
        {
          backgroundColor: colors.surface_container_highest,
          borderColor: colors.outline_variant,
          borderRadius: radius.md,
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.md,
          shadowColor: shadows.medium.shadowColor,
          opacity: opacityAnim,
        },
      ]}
    >
      <Text
        allowFontScaling
        style={[
          styles.toastText,
          {
            color: colors.on_surface,
            fontFamily: typography.bodyMedium.fontFamily,
            fontSize: typography.bodyMedium.fontSize,
            lineHeight: typography.bodyMedium.lineHeight,
          },
        ]}
      >
        {message}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    borderWidth: 1,
    elevation: 6,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  overlayPosition: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toastText: {
    textAlign: 'center',
  },
});

