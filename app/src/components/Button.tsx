import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

export type ButtonVariant = 'primary' | 'secondary' | 'text';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  textColor?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  textColor,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}) => {
  const { colors, spacing, radius, typography } = useTheme();
  const [isPressed, setIsPressed] = useState(false);

  const getContainerStyle = () => {
    let backgroundColor = 'transparent';
    let borderColor = 'transparent';
    let borderWidth = 0;

    if (variant === 'primary') {
      backgroundColor = colors.primary;
    } else if (variant === 'secondary') {
      backgroundColor = colors.secondary;
    } else if (variant === 'text') {
      backgroundColor = 'transparent';
    }

    if (disabled) {
      if (variant === 'text') {
        backgroundColor = 'transparent';
      } else {
        backgroundColor = colors.surface_container_highest;
      }
    } else if (isPressed) {
      if (variant === 'primary') {
        backgroundColor = colors.primary_text_high;
      } else if (variant === 'secondary') {
        backgroundColor = colors.secondary_container;
      }
    }

    return {
      backgroundColor,
      borderColor,
      borderWidth,
    };
  };

  const getTextColor = () => {
    if (disabled) {
      return colors.outline;
    }
    if (textColor) {
      return textColor;
    }
    if (variant === 'primary') {
      return colors.on_primary;
    }
    if (variant === 'secondary') {
      return isPressed ? colors.on_secondary_container : colors.on_secondary;
    }
    return colors.primary_text;
  };

  const effectiveLabel = accessibilityLabel || title;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={effectiveLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      style={({ pressed }) => [
        styles.baseButton,
        {
          minHeight: 48, // Meets >= 44 pt requirement
          minWidth: 44,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderRadius: radius.md,
        },
        getContainerStyle(),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={getTextColor()}
          accessibilityLabel={STRINGS.common.loading}
        />
      ) : (
        <Text
          allowFontScaling
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[
            styles.buttonText,
            {
              color: getTextColor(),
              fontFamily: typography.labelLarge.fontFamily,
              fontSize: typography.labelLarge.fontSize,
              fontWeight: typography.labelLarge.fontWeight,
              lineHeight: typography.labelLarge.lineHeight,
              letterSpacing: typography.labelLarge.letterSpacing,
            },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    textAlign: 'center',
  },
});

