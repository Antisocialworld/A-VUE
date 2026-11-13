import React, { useImperativeHandle, useRef, useState } from 'react';
import {
  KeyboardTypeOptions,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAutoFocus } from '../hooks/useAutoFocus';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  secureTextEntry?: boolean;
  rightAccessory?: React.ReactNode;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const TextField = React.forwardRef<React.ComponentRef<typeof TextInput>, TextFieldProps>(
  (
    {
      label,
      value,
      onChangeText,
      placeholder,
      error,
      helperText,
      disabled = false,
      secureTextEntry = false,
      rightAccessory,
      autoCapitalize = 'none',
      keyboardType = 'default',
      autoFocus = false,
      accessibilityLabel,
      accessibilityHint,
      testID,
      style,
      onFocus,
      onBlur,
    },
    ref,
  ) => {
    const { colors, spacing, radius, typography } = useTheme();
    const [isFocused, setIsFocused] = useState(false);
    const internalInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

    useImperativeHandle(ref, () => internalInputRef.current!);

    // Auto-focus after screen transition finishes via shared useAutoFocus hook (Task 1)
    useAutoFocus(internalInputRef, autoFocus && !disabled);

    const handleFocus = () => {
      setIsFocused(true);
      onFocus?.();
    };

    const handleBlur = () => {
      setIsFocused(false);
      onBlur?.();
    };

    const getBorderColor = () => {
      if (disabled) {
        return colors.surface_container_highest;
      }
      if (error) {
        return colors.error;
      }
      if (isFocused) {
        return colors.primary;
      }
      return colors.outline_variant;
    };

    const getBackgroundColor = () => {
      if (disabled) {
        return colors.surface_container_low;
      }
      return colors.surface_container_lowest;
    };

    const effectiveAccessibilityLabel = accessibilityLabel || label;

    // React Native Android masking fix:
    // When secureTextEntry is true, setting a custom fontFamily can omit the native bullet glyph (•),
    // and setting lineHeight on TextInput causes vertical text clipping.
    const textInputStyle: TextStyle = {
      color: disabled ? colors.outline : colors.on_surface,
      fontSize: typography.bodyLarge.fontSize,
      fontFamily: secureTextEntry ? undefined : typography.bodyLarge.fontFamily,
      paddingVertical: spacing.sm,
    };

    return (
      <View style={[styles.container, { marginBottom: spacing.md }, style]}>
        {/* Label (Task 5: not a header) */}
        <Text
          allowFontScaling
          style={[
            styles.label,
            {
              color: disabled ? colors.outline : colors.on_surface,
              marginBottom: spacing.xs,
              fontFamily: typography.labelMedium.fontFamily,
              fontSize: typography.labelMedium.fontSize,
              fontWeight: typography.labelMedium.fontWeight,
              lineHeight: typography.labelMedium.lineHeight,
            },
          ]}
        >
          {label}
        </Text>

        {/* Input container */}
        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: getBackgroundColor(),
              borderColor: getBorderColor(),
              borderWidth: isFocused || error ? 1.5 : 1,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              minHeight: 48, // Touch target >= 44
            },
          ]}
        >
          <TextInput
            ref={internalInputRef}
            testID={testID}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.outline}
            editable={!disabled}
            secureTextEntry={secureTextEntry}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            onFocus={handleFocus}
            onBlur={handleBlur}
            allowFontScaling
            accessibilityLabel={effectiveAccessibilityLabel}
            accessibilityHint={accessibilityHint}
            accessibilityState={{ disabled }}
            style={[styles.input, textInputStyle]}
          />
          {rightAccessory && <View style={styles.rightAccessory}>{rightAccessory}</View>}
        </View>

        {/* Error or Helper text */}
        {error ? (
          <Text
            allowFontScaling
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.messageText,
              {
                color: colors.error,
                marginTop: spacing.xs,
                fontFamily: typography.bodySmall.fontFamily,
                fontSize: typography.bodySmall.fontSize,
                lineHeight: typography.bodySmall.lineHeight,
              },
            ]}
          >
            {error}
          </Text>
        ) : helperText ? (
          <Text
            allowFontScaling
            style={[
              styles.messageText,
              {
                color: colors.on_surface_variant,
                marginTop: spacing.xs,
                fontFamily: typography.bodySmall.fontFamily,
                fontSize: typography.bodySmall.fontSize,
                lineHeight: typography.bodySmall.lineHeight,
              },
            ]}
          >
            {helperText}
          </Text>
        ) : null}
      </View>
    );
  },
);

TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    letterSpacing: -0.1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  input: {
    flex: 1,
    padding: 0,
    margin: 0,
  },
  rightAccessory: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    letterSpacing: -0.08,
  },
});
