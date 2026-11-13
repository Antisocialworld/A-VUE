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
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'outlined';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
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
  borderColor: customBorderColor,
  borderWidth: customBorderWidth,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}) => {
  const { colors, spacing, radius, typography, mode } = useTheme();
  const [isPressed, setIsPressed] = useState(false);

  const getContainerStyle = () => {
    let backgroundColor = 'transparent';
    let borderColor = 'transparent';
    let borderWidth = 0;

    if (variant === 'primary') {
      backgroundColor = colors.primary;
    } else if (variant === 'secondary') {
      backgroundColor = colors.secondary;
    } else if (variant === 'outlined') {
      backgroundColor = 'transparent';
      borderColor =
        customBorderColor ||
        (mode === 'dark' ? colorData.palettes.primary['80'] : colorData.palettes.primary['30']);
      borderWidth = customBorderWidth !== undefined ? customBorderWidth : 3;
    } else if (variant === 'text') {
      backgroundColor = 'transparent';
    }

    if (disabled) {
      if (variant === 'text' || variant === 'outlined') {
        backgroundColor = 'transparent';
        if (variant === 'outlined') {
          borderColor = colors.outline;
        }
      } else {
        backgroundColor = colors.surface_container_highest;
      }
    } else if (isPressed) {
      if (variant === 'primary') {
        backgroundColor = colors.primary_text_high;
      } else if (variant === 'secondary') {
        backgroundColor = colors.secondary_container;
      } else if (variant === 'outlined') {
        backgroundColor = 'transparent';
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
    if (variant === 'outlined') {
      return mode === 'dark' ? colorData.palettes.primary['80'] : colors.on_surface;
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

